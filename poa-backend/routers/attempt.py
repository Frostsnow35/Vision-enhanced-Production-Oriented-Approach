"""
产出记录路由 —— 提交作答 + 诊断。
"""
from fastapi import APIRouter

from schemas import (
    AttemptSubmitRequest,
    AttemptSubmitResponse,
)
from services.ai_service import (
    diagnose_attempt,
)

router = APIRouter(prefix="/api", tags=["attempt"])


# === POST /api/attempt1/submit ===
@router.post("/attempt1/submit", response_model=AttemptSubmitResponse)
async def submit_attempt1(req: AttemptSubmitRequest):
    """
    提交第一次作答（改进前），AI 诊断并返回语言/语用不足列表（Gap）。
    请求参数：
    - attempt_text: 学生的作答文本（语音转写或直接输入）
    """
    result = diagnose_attempt(attempt_text=req.attempt_text)
    return result


# === POST /api/attempt2/submit ===
@router.post("/attempt2/submit", response_model=AttemptSubmitResponse)
async def submit_attempt2(req: AttemptSubmitRequest):
    """
    提交第二次作答（改进后），AI 诊断并返回剩余不足列表。
    参数与 attempt1 一致。
    """
    result = diagnose_attempt(attempt_text=req.attempt_text)
    return result
