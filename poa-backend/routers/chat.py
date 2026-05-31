"""
对话路由 —— AI 开场白 + 对话轮次（ASR → 生成回复）。
"""
import os
import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.chat_service import generate_opening, generate_reply
from services.asr_service import transcribe_audio, NO_VOICE_MARKER

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
    audio_url: str
    conversation_history: list = []
    scene_label: str = ""
    roles: str = ""
    variant_context: str = ""


class ChatTurnResponse(BaseModel):
    ai_text: str
    ai_audio_url: str
    user_text: str = ""


# ---- POST /api/chat/start ----
@router.post("/start", response_model=ChatStartResponse)
async def chat_start(req: ChatStartRequest):
    """
    生成 AI 开场白。
    请求可携带 task_id 和场景信息，也可从 localStorage 的 currentTask 提供。
    """
    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "goal": req.goal,
        "variant_context": req.variant_context if req.is_variant else "",
    }

    ai_text = generate_opening(task_context)

    return ChatStartResponse(ai_text=ai_text, ai_audio_url="")


# ---- POST /api/chat/turn ----
@router.post("/turn", response_model=ChatTurnResponse)
async def chat_turn(req: ChatTurnRequest):
    """
    处理一个对话轮次：
    1. ASR 转写用户音频 → user_text
    2. LLM 生成 AI 回复 → ai_text
    """
    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "variant_context": req.variant_context,
    }

    # 1. ASR 转写
    audio_path = req.audio_url
    if audio_path.startswith("/"):
        audio_path = audio_path[1:]  # 去掉前导 /，变成相对路径
    if not os.path.isfile(audio_path):
        logger.warning(f"[chat] 音频文件不可访问: {audio_path}")
        # 尝试在 uploads 下查找
        alt_path = os.path.join("uploads", "audio", os.path.basename(audio_path))
        if os.path.isfile(alt_path):
            audio_path = alt_path
        else:
            return ChatTurnResponse(
                ai_text="Sorry, I couldn't hear that. Could you try again?",
                ai_audio_url="",
                user_text="",
            )

    user_text = transcribe_audio(audio_path)

    # ASR 失败 / 空转写 → 不调用 LLM，直接返回 422
    if not user_text or not user_text.strip() or user_text == NO_VOICE_MARKER:
        logger.warning(f"[chat] ASR 无效 — text={user_text!r}")
        return JSONResponse(
            status_code=422,
            content={
                "error": "audio_unclear",
                "message": "语音未能识别，请大声重试。",
            },
        )

    logger.info(f"[chat] ASR 结果: {user_text[:100]}")

    # 2. 生成回复
    ai_text = generate_reply(
        conversation_history=req.conversation_history,
        user_text=user_text,
        task_context=task_context,
    )

    return ChatTurnResponse(ai_text=ai_text, ai_audio_url="", user_text=user_text)
