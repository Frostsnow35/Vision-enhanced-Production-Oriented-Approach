"""
产出记录路由 —— 提交作答（文本 + 语音转写） + 诊断。
"""
import os
import logging
from typing import List

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from schemas import (
    AttemptSubmitRequest,
    AttemptSubmitResponse,
)
from services.ai_service import diagnose_attempt
from services.asr_service import transcribe_audio
from config import UPLOAD_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("attempt_router")

router = APIRouter(prefix="/api", tags=["attempt"])


def _build_diagnosis_text(req: AttemptSubmitRequest) -> str:
    """
    从请求中提取用于诊断的全文。
    优先使用 conversation 数组（新格式），fallback 到 attempt_text（旧格式）。
    对 conversation 中的音频消息，调用 Whisper 转写后追加到文本中。
    """
    # 1. 如果前端传了 conversation 数组，遍历提取文本 + 转写音频
    if req.conversation:
        parts: List[str] = []
        for msg in req.conversation:
            if msg.type == "text" and msg.content:
                parts.append(f"[{msg.role}]: {msg.content}")
            elif msg.type == "audio" and msg.audio_url:
                audio_file = msg.audio_url
                if audio_file.startswith(UPLOAD_DIR.rstrip("/")) and os.path.isfile(audio_file):
                    logger.info(f"[attempt] 转写音频: {audio_file}")
                    transcribed = transcribe_audio(audio_file)
                    if transcribed:
                        parts.append(f"[{msg.role}]: {transcribed}")
                    else:
                        logger.warning(f"[attempt] 转写为空或失败: {audio_file}")
                else:
                    logger.warning(f"[attempt] 音频文件不可访问: {audio_file}")
        if parts:
            return "\n".join(parts)

    # 2. fallback: 旧格式的 attempt_text
    if req.attempt_text:
        return req.attempt_text

    return ""


# === POST /api/attempt1/submit ===
@router.post("/attempt1/submit", response_model=AttemptSubmitResponse)

async def submit_attempt1(req: AttemptSubmitRequest):
    """
    提交第一次作答（改进前），AI 诊断并返回语言/语用不足列表（Gap）。

    请求体支持两种格式：
      新: { task_id, conversation: [...], attempt_number: 1 }
      旧: { attempt_text: "..." }

    conversation 中的音频消息会自动调用 Whisper 转写。
    """
    diagnosis_text = _build_diagnosis_text(req)
    if not diagnosis_text:
        # 如果完全没内容，返回空诊断
        return AttemptSubmitResponse(gaps=[])
    result = diagnose_attempt(attempt_text=diagnosis_text)
    return result


@router.post("/attempt2/submit", response_model=AttemptSubmitResponse)

async def submit_attempt2(req: AttemptSubmitRequest):
    """
    提交第二次作答（改进后），AI 诊断并返回剩余不足列表。
    逻辑与 attempt1 一致。
    """
    diagnosis_text = _build_diagnosis_text(req)
    if not diagnosis_text:
        return AttemptSubmitResponse(gaps=[])
    result = diagnose_attempt(attempt_text=diagnosis_text)
    return result
