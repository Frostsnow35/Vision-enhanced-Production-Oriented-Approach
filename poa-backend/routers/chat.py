"""
对话路由 —— AI 开场白 + 对话轮次（ASR → 生成回复 → TTS）。
"""
import json
import os
import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from services.chat_service import generate_opening, generate_reply, text_to_speech, _generate_turn_feedback
from services.asr_service import transcribe_with_doubao_standard
from config import UPLOAD_DIR

# 公网可访问的后端地址，优先用环境变量（Railway 容器内 request.base_url 可能是内网地址）
_BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "").rstrip("/")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_router")

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _clip_text(text: str, limit: int = 160) -> str:
    """裁剪日志文本，避免单条日志过长。"""
    value = "" if text is None else str(text)
    value = value.replace("\n", "\\n")
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _build_public_audio_url(request: Request, audio_path: str) -> tuple:
    """
    构造音频的公网可访问 URL，供火山引擎标准版 ASR 下载。
    标准版仅支持 wav/mp3/ogg，前端录制的是 webm/opus，需用 ffmpeg 转码为 mp3
    并存放到 uploads 目录（静态挂载可访问）。
    @return (url, audio_format)：url 为公网 URL，audio_format 为实际容器格式（wav/mp3/ogg），
            失败返回 ("", "")
    """
    try:
        import subprocess
        import uuid

        # 优先使用环境变量 BACKEND_PUBLIC_URL（Railway 公网地址），
        # 否则用 request.base_url（本地开发 localhost:8000 等）
        base_url = _BACKEND_PUBLIC_URL if _BACKEND_PUBLIC_URL else str(request.base_url).rstrip("/")
        logger.info(f"[chat] ASR 公网 base_url: {base_url}")
        ext = os.path.splitext(audio_path)[-1].lower()

        # webm/m4a/ogg/mp4/aac → 转码为 mp3（标准版仅支持 wav/mp3/ogg）
        if ext in (".webm", ".m4a", ".ogg", ".mp4", ".aac"):
            mp3_dir = os.path.join(UPLOAD_DIR, "audio")
            os.makedirs(mp3_dir, exist_ok=True)
            mp3_name = f"asr_{uuid.uuid4().hex}.mp3"
            mp3_path = os.path.join(mp3_dir, mp3_name)
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", "-b:a", "64k", mp3_path],
                capture_output=True, timeout=30,
            )
            if result.returncode != 0 or not os.path.isfile(mp3_path):
                logger.warning(f"[chat] ffmpeg 转码 ASR 音频失败: {result.stderr.decode()[:200]}")
                return "", ""
            return f"{base_url}/uploads/audio/{mp3_name}", "mp3"
        # wav/mp3 直接使用原始文件，返回其真实格式
        rel = os.path.relpath(audio_path, UPLOAD_DIR).replace("\\", "/")
        real_format = ext.lstrip(".")  # wav → "wav", mp3 → "mp3", ogg → "ogg"
        return f"{base_url}/uploads/{rel}", real_format
    except Exception as e:
        logger.warning(f"[chat] 构造 ASR 公网音频 URL 失败: {e}")
        return "", ""


def _serialize_history_for_log(conversation_history: list) -> str:
    """压缩 conversation_history，便于在日志中查看关键字段。"""
    preview = []
    for turn in conversation_history[-6:]:
        preview.append(
            {
                "role": turn.get("role", ""),
                "text": _clip_text(turn.get("text") or turn.get("content") or "", 120),
            }
        )
    return json.dumps(preview, ensure_ascii=False)


# ---- 请求/响应模型 ----

class ChatStartRequest(BaseModel):
    task_id: int = 0
    is_variant: bool = False
    variant_context: str = ""
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    evaluation_criteria: str = ""
    opening_line: str = ""


class ChatStartResponse(BaseModel):
    ai_text: str
    ai_audio_url: str


class ConversationItem(BaseModel):
    role: str
    text: Optional[str] = None
    content: Optional[str] = None
    audio_url: Optional[str] = None


class ChatTurnRequest(BaseModel):
    task_id: int = 0
    audio_url: str = ""
    user_text: str = ""
    conversation_history: list = []
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    evaluation_criteria: str = ""
    variant_context: str = ""
    closing_line: str = ""


class ChatTurnResponse(BaseModel):
    ai_text: str
    ai_audio_url: str
    is_final: bool = False
    turn_feedback: dict = {}  # 实时短反馈 {dimensions: [...], short_comment: "..."}
    user_text: str = ""  # Whisper 转写后的用户文本，供后续诊断复用
    llm_error: str = ""  # 模型调用失败时返回真实错误原因，非空表示本次未正常走模型推理
    asr_error: str = ""  # ASR 转写失败时返回原因，用于前端诊断提示


# ---- POST /api/chat/start ----
@router.post("/start", response_model=ChatStartResponse)

async def chat_start(req: ChatStartRequest):
    """
    生成 AI 开场白 + TTS 语音。
    文字秒返回；若 TTS 缓存命中则带音频 URL，否则后台生成、前端用浏览器语音。
    """
    import time as _time
    _t0 = _time.time()

    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "goal": req.goal,
        "evaluation_criteria": req.evaluation_criteria,
        "variant_context": req.variant_context if req.is_variant else "",
    }

    if req.opening_line and req.opening_line.strip():
        ai_text = req.opening_line.strip()
        logger.info(f"[chat/start] 使用预生成 opening_line: {ai_text[:60]}")
    else:
        ai_text = generate_opening(task_context)

    ai_audio_url = ""
    if ai_text:
        # 同步生成 TTS（text_to_speech 内部有缓存，命中则秒返）
        try:
            ai_audio_url = text_to_speech(ai_text) or ""
        except Exception as ex:
            logger.warning(f"[chat/start] TTS 生成失败: {ex}")

    logger.info(f"[chat/start] 响应耗时: {(_time.time() - _t0)*1000:.0f}ms, has_audio={bool(ai_audio_url)}")
    return ChatStartResponse(ai_text=ai_text, ai_audio_url=ai_audio_url)


# ---- POST /api/chat/tts（独立 TTS，用于 mock 降级开场白等场景）----
class TTSRequest(BaseModel):
    text: str


class TTSResponse(BaseModel):
    audio_url: str


@router.post("/tts", response_model=TTSResponse)
async def chat_tts(req: TTSRequest):
    url = text_to_speech(req.text) if req.text else ""
    return TTSResponse(audio_url=url)


# ---- POST /api/chat/turn ----
@router.post("/turn", response_model=ChatTurnResponse)

async def chat_turn(req: ChatTurnRequest, request: Request):
    """
    处理一个对话轮次。
    如果前端传了 user_text（Web Speech API 转写结果），直接跳过 ASR；
    否则对 audio_url 执行 ASR 转写。
    之后 LLM 生成 AI 回复 → TTS 合成语音。
    返回 is_final 标记对话是否已自然结束。
    """
    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "goal": req.goal,
        "evaluation_criteria": req.evaluation_criteria,
        "variant_context": req.variant_context,
        "closing_line": req.closing_line,
    }

    # 1. 获取用户文本：仅豆包标准版 ASR（无降级）
    frontend_text = req.user_text.strip()
    user_text = ""
    user_text_source = "unresolved"
    asr_error = ""

    logger.info(
        f"[chat/turn] 收到请求: audio_url={req.audio_url or '<empty>'}, "
        f"frontend_text={_clip_text(frontend_text, 120)}, "
        f"conversation_history_count={len(req.conversation_history)}, "
        f"conversation_history_preview={_serialize_history_for_log(req.conversation_history)}"
    )

    if req.audio_url:
        audio_path = req.audio_url
        # 解析音频路径：将URL路径转换为本地绝对路径
        if audio_path.startswith("/uploads/"):
            rel = audio_path[len("/uploads/"):]
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, rel))
        elif audio_path.startswith("/"):
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, audio_path[1:]))
        elif not os.path.isabs(audio_path):
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, audio_path))

        if os.path.isfile(audio_path):
            # 火山引擎录音文件识别标准版（提交任务 + 查询结果）
            public_url, audio_format = _build_public_audio_url(request, audio_path)
            if public_url and audio_format:
                user_text = transcribe_with_doubao_standard(public_url, audio_format=audio_format)
                if user_text:
                    user_text_source = "standard_asr"
                    logger.info(f"[chat] ASR 结果: {user_text[:100]}")
                else:
                    asr_error = "standard_asr_no_result"
            else:
                asr_error = "audio_conversion_failed"
        else:
            asr_error = "audio_file_missing"
            logger.warning(f"[chat/turn] 音频文件不存在: {audio_path}")
    else:
        asr_error = "no_audio_url"

    # ASR 失败 → [inaudible]
    if not user_text:
        user_text = "[inaudible]"
        user_text_source = "fallback_inaudible"

    logger.info(
        f"[chat/turn] 最终 user_text 已确定: source={user_text_source}, "
        f"user_text={_clip_text(user_text, 200)}"
    )

    # 2. 生成回复
    llm_error = ""
    try:
        ai_text, is_final = generate_reply(
            conversation_history=req.conversation_history,
            user_text=user_text,
            task_context=task_context,
        )
    except RuntimeError as e:
        llm_error = str(e)
        logger.error(f"[chat/turn] 模型调用失败，返回错误前端: {llm_error}")
        ai_text = f"[模型调用失败] {llm_error}。请检查 API Key 与模型 ID 配置，或稍后重试。"
        is_final = False
        ai_audio_url = ""
        return ChatTurnResponse(
            ai_text=ai_text,
            ai_audio_url="",
            is_final=False,
            turn_feedback={},
            user_text=user_text if user_text != "[inaudible]" else "",
            llm_error=llm_error,
            asr_error=asr_error,
        )

    # 3. 实时短反馈（针对用户本轮输入）
    turn_feedback = _generate_turn_feedback(user_text, ai_text, task_context)

    # 4. TTS
    ai_audio_url = text_to_speech(ai_text) if ai_text else ""

    response_user_text = user_text if user_text != "[inaudible]" else ""
    logger.info(
        f"[chat/turn] 回传前端文本: ai_text={_clip_text(ai_text, 200)}, "
        f"user_text={_clip_text(response_user_text, 200)}, "
        f"is_final={is_final}, ai_audio_url={ai_audio_url or '<empty>'}"
    )

    return ChatTurnResponse(
        ai_text=ai_text,
        ai_audio_url=ai_audio_url,
        is_final=is_final,
        turn_feedback=turn_feedback,
        user_text=response_user_text,
        asr_error=asr_error,
    )


# ---- GET /api/chat/debug/asr-diag ----
class AsrDiagResponse(BaseModel):
    upload_dir: str
    upload_dir_exists: bool
    backend_public_url: str
    ffmpeg_available: bool
    asr_pipeline_ok: bool = False
    silent_test: str = ""  # 静音测试结果
    speech_test_phrase: str = ""  # 真实语音测试用短语
    speech_test_submit_ok: bool = False
    speech_test_result: str = ""  # ASR 对真实语音的转写结果
    errors: list = []


@router.get("/debug/asr-diag", response_model=AsrDiagResponse)
async def asr_diag(request: Request):
    """
    ASR 全链路诊断：静音连通性测试 + 真实语音(TTS)转写测试。
    若 speech_test_result 含预期文字则说明 ASR 全链路正常。
    """
    # ASR 全链路诊断：真实语音(TTS)转写测试（跳过静音测试避免 Railway 超时）
    import subprocess
    import uuid

    errors: list = []
    backend_url = _BACKEND_PUBLIC_URL or str(request.base_url).rstrip("/")
    mp3_dir = os.path.join(UPLOAD_DIR, "audio")
    os.makedirs(mp3_dir, exist_ok=True)

    # 1. 基础检查
    upload_dir_exists = os.path.isdir(UPLOAD_DIR)
    ffmpeg_available = False
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        ffmpeg_available = r.returncode == 0
    except Exception:
        pass

    # 2. 真实语音 ASR 测试（用 gTTS 生成短句 → 提交火山 ASR）
    speech_test_phrase = ""
    speech_test_submit_ok = False
    speech_test_result = ""
    asr_pipeline_ok = False
    if upload_dir_exists and ffmpeg_available:
        try:
            from gtts import gTTS
            speech_test_phrase = "Hello, this is a test."
            speech_name = f"asr_diag_{uuid.uuid4().hex}.mp3"
            speech_path = os.path.join(mp3_dir, speech_name)
            tts = gTTS(text=speech_test_phrase, lang="en", slow=False)
            tts.save(speech_path)

            if os.path.isfile(speech_path) and os.path.getsize(speech_path) > 500:
                speech_url = f"{backend_url}/uploads/audio/{speech_name}"
                from services.asr_service import transcribe_with_doubao_standard
                result = transcribe_with_doubao_standard(speech_url, audio_format="mp3", max_wait_sec=15)
                if result:
                    speech_test_submit_ok = True
                    speech_test_result = result
                    asr_pipeline_ok = "hello" in result.lower()
                else:
                    errors.append("ASR 提交/查询成功但未返回转写（可能是网络或超时）")
                try:
                    os.remove(speech_path)
                except Exception:
                    pass
            else:
                errors.append("gTTS 生成音频过小")
        except ImportError:
            errors.append("gTTS 未安装")
        except Exception as e:
            errors.append(f"测试异常: {str(e)[:120]}")
    else:
        errors.append(f"前置条件不满足: dir={upload_dir_exists} ffmpeg={ffmpeg_available}")

    return AsrDiagResponse(
        upload_dir=UPLOAD_DIR,
        upload_dir_exists=upload_dir_exists,
        backend_public_url=backend_url,
        ffmpeg_available=ffmpeg_available,
        asr_pipeline_ok=asr_pipeline_ok,
        silent_test="skipped",
        speech_test_phrase=speech_test_phrase,
        speech_test_submit_ok=speech_test_submit_ok,
        speech_test_result=speech_test_result,
        errors=errors,
    )
