"""
对话路由 —— AI 开场白 + 对话轮次（ASR → 生成回复 → TTS）。
"""
import os
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services.chat_service import generate_opening, generate_reply, text_to_speech, _generate_turn_feedback
from services.asr_service import transcribe_audio

UPLOAD_DIR = os.path.normpath(os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads")))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_router")

router = APIRouter(prefix="/api/chat", tags=["chat"])


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

    # 1. 获取用户文本：优先 Whisper ASR（更准确），不可用时回退前端 Web Speech
    frontend_text = req.user_text.strip()
    user_text = ""

    if req.audio_url:
        audio_path = req.audio_url
        # 解析音频路径：将URL路径转换为本地绝对路径
        if audio_path.startswith("/uploads/"):
            rel = audio_path[len("/uploads/"):]
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, rel))
        elif audio_path.startswith("/"):
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, audio_path[1:]))
        elif not os.path.isabs(audio_path):
            # 相对路径：尝试拼接 UPLOAD_DIR
            audio_path = os.path.normpath(os.path.join(UPLOAD_DIR, audio_path))

        if os.path.isfile(audio_path):
            user_text = transcribe_audio(audio_path)
            logger.info(f"[chat] Whisper ASR 结果: {user_text[:100] if user_text else '(空)'}")

    # Whisper 不可用或转写为空时，回退前端 Web Speech 文本
    if not user_text and frontend_text:
        user_text = frontend_text
        logger.info(f"[chat] Whisper 不可用，回退前端文本: {user_text[:100]}")

    if not user_text:
        user_text = "[inaudible]"

    # 2. 生成回复
    ai_text, is_final = generate_reply(
        conversation_history=req.conversation_history,
        user_text=user_text,
        task_context=task_context,
    )

    # 3. 实时短反馈（针对用户本轮输入）
    turn_feedback = _generate_turn_feedback(user_text, ai_text, task_context)

    # 4. TTS
    ai_audio_url = text_to_speech(ai_text) if ai_text else ""

    return ChatTurnResponse(
        ai_text=ai_text,
        ai_audio_url=ai_audio_url,
        is_final=is_final,
        turn_feedback=turn_feedback,
        user_text=user_text if user_text != "[inaudible]" else "",
    )
