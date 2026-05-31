"""
产出记录路由 —— 提交作答 + 诊断。
"""
import logging
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from schemas import AttemptSubmitRequest
from services.ai_service import diagnose_attempt
from services.asr_service import NO_VOICE_MARKER

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("attempt_router")

router = APIRouter(prefix="/api", tags=["attempt"])


def _build_no_voice_response(text: str = "") -> JSONResponse:
    """构建"无有效语音"错误响应，HTTP 200 但包含 error 字段。"""
    return JSONResponse(
        status_code=200,
        content={
            "error": "no_voice",
            "message": "未检测到有效语音，请重新录制。",
            "gaps": [],
            "note": "未检测到有效语音内容，无法生成诊断。",
            "transcribed_text": text,
        },
    )


def _build_empty_diagnosis(text: str = "") -> Dict[str, Any]:
    """构建空诊断结果，不调用 LLM。"""
    return {
        "gaps": [],
        "note": "未检测到有效语音内容，无法生成诊断。",
        "transcribed_text": text,
    }


# === POST /api/attempt1/submit ===
@router.post("/attempt1/submit")
async def submit_attempt1(req: AttemptSubmitRequest):
    """
    提交第一次作答（改进前），AI 诊断并返回语言/语用不足列表（Gap）。
    请求参数：
    - attempt_text: 学生的作答文本（语音转写或直接输入）
    """
    text = (req.attempt_text or "").strip()
    logger.info(f"[attempt1] 收到转写文本 ({len(text)} chars): {text[:200]}")

    # 文本为空 → 返回空诊断 + note
    if not text:
        return _build_empty_diagnosis(text)

    # ASR 无效 → 返回提示
    if text == NO_VOICE_MARKER:
        return _build_no_voice_response(text)

    result = diagnose_attempt(attempt_text=text)
    result["transcribed_text"] = text
    return result


# === POST /api/attempt2/submit ===
@router.post("/attempt2/submit")
async def submit_attempt2(req: AttemptSubmitRequest):
    """
    提交第二次作答（改进后），AI 诊断并返回剩余不足列表。
    参数与 attempt1 一致。
    """
    text = (req.attempt_text or "").strip()
    logger.info(f"[attempt2] 收到转写文本 ({len(text)} chars): {text[:200]}")

    # 文本为空 → 返回空诊断 + note
    if not text:
        return _build_empty_diagnosis(text)

    # ASR 无效 → 返回提示
    if text == NO_VOICE_MARKER:
        return _build_no_voice_response(text)

    result = diagnose_attempt(attempt_text=text)
    result["transcribed_text"] = text
    return result
