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
    try:
        task_context = {
            "scene_label": req.scene_label,
            "roles": req.roles,
            "variant_context": req.variant_context,
        }

        # 1. ASR 转写
        audio_path = req.audio_url
        if audio_path.startswith("/"):
            audio_path = audio_path[1:]

        if not os.path.isfile(audio_path):
            alt_path = os.path.join("uploads", "audio", os.path.basename(audio_path))
            if os.path.isfile(alt_path):
                audio_path = alt_path
            else:
                return JSONResponse(
                    status_code=422,
                    content={
                        "error": "invalid_audio",
                        "message": "音频文件无效或已过期，请重新录制",
                    },
                )

        try:
            user_text = transcribe_audio(audio_path)
        except Exception as e:
            logger.error(f"[chat] ASR 异常: {e}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": "transcription_failed",
                    "message": "语音识别服务异常，请稍后重试",
                },
            )

        if not user_text or not user_text.strip() or user_text == NO_VOICE_MARKER:
            logger.warning(f"[chat] ASR 空 — text={user_text!r}")
            return JSONResponse(
                status_code=422,
                content={
                    "error": "empty_audio",
                    "message": "未检测到语音内容，请大声说话或检查麦克风",
                },
            )

        logger.info(f"[chat] ASR 结果: {user_text[:100]}")

        ai_text = generate_reply(
            conversation_history=req.conversation_history,
            user_text=user_text,
            task_context=task_context,
        )

        return ChatTurnResponse(ai_text=ai_text, ai_audio_url="", user_text=user_text)

    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"[chat] 未捕获异常: {e}\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "message": f"服务器内部错误: {str(e)[:200]}",
            },
        )
