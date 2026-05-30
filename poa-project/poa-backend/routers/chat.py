"""
对话路由 —— AI 开场白 + 对话轮次（ASR → 生成回复 → TTS）。
"""
import os
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services.chat_service import generate_opening, generate_reply, text_to_speech
from services.asr_service import transcribe_audio

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


class ChatTurnResponse(BaseModel):
    ai_text: str
    ai_audio_url: str
    is_final: bool = False


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

    ai_text = generate_opening(task_context)
    ai_audio_url = text_to_speech(ai_text) if ai_text else ""

    return ChatStartResponse(ai_text=ai_text, ai_audio_url=ai_audio_url)


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
    }

    # 1. 获取用户文本：优先使用前端传的 user_text，否则走 ASR
    user_text = req.user_text.strip()
    if user_text:
        logger.info(f"[chat] 使用前端直传文本: {user_text[:100]}")
    elif req.audio_url:
        audio_path = req.audio_url
        if audio_path.startswith("/"):
            audio_path = audio_path[1:]
        if not os.path.isfile(audio_path):
            logger.warning(f"[chat] 音频文件不可访问: {audio_path}")
            alt_path = os.path.join("uploads", "audio", os.path.basename(audio_path))
            if os.path.isfile(alt_path):
                audio_path = alt_path
            else:
                return ChatTurnResponse(
                    ai_text="Sorry, I couldn't hear that. Could you try again?",
                    ai_audio_url="",
                    is_final=False,
                )

        user_text = transcribe_audio(audio_path)
        logger.info(f"[chat] ASR 结果: {user_text[:100]}")

    if not user_text:
        user_text = "[inaudible]"

    # 2. 生成回复
    ai_text, is_final = generate_reply(
        conversation_history=req.conversation_history,
        user_text=user_text,
        task_context=task_context,
    )

    # 3. TTS
    ai_audio_url = text_to_speech(ai_text) if ai_text else ""

    return ChatTurnResponse(ai_text=ai_text, ai_audio_url=ai_audio_url, is_final=is_final)
