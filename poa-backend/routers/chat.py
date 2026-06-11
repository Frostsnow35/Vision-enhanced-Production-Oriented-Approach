"""
对话路由 —— AI 开场白 + 对话轮次（ASR → 生成回复 → TTS）。
"""
import json
import os
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services.chat_service import generate_opening, generate_reply, text_to_speech, _generate_turn_feedback
from services.asr_service import transcribe_audio, transcribe_with_doubao_flash

UPLOAD_DIR = os.path.normpath(os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads")))

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


# ---- POST /api/chat/start ----
@router.post("/start", response_model=ChatStartResponse)

async def chat_start(req: ChatStartRequest):
    """
    生成 AI 开场白 + TTS 语音。
    请求可携带 task_id 和场景信息，也可从 localStorage 的 currentTask 提供。
    """
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
    ai_audio_url = text_to_speech(ai_text) if ai_text else ""

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

async def chat_turn(req: ChatTurnRequest):
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

    # 1. 获取用户文本：Flash ASR（云端毫秒级）→ Whisper（本地）→ Web Speech（浏览器）
    frontend_text = req.user_text.strip()
    user_text = ""
    user_text_source = "unresolved"

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
            # 策略 1: 火山引擎 Flash ASR（最快，复用 DOUBAO_API_KEY）
            user_text = transcribe_with_doubao_flash(audio_path)
            if user_text:
                user_text_source = "flash_asr"
                logger.info(f"[chat] Flash ASR 结果: {user_text[:100]}")
            # 策略 2: Whisper 本地
            if not user_text:
                user_text = transcribe_audio(audio_path)
                if user_text:
                    user_text_source = "whisper_asr"
                    logger.info(f"[chat] Whisper ASR 结果: {user_text[:100]}")
        else:
            logger.warning(f"[chat/turn] 音频文件不存在，跳过服务端 ASR: {audio_path}")

    # 策略 3: 浏览器 Web Speech 文本
    if not user_text and frontend_text:
        user_text = frontend_text
        user_text_source = "web_speech"
        logger.info(f"[chat] ASR 无结果，回退 Web Speech: {user_text[:100]}")

    # 全部失败 → [inaudible]，LLM 按 prompt 规则自然处理
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
    )
