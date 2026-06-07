"""
评价路由 —— 单次七维评估、双轨对比评价。
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from schemas import (
    EvaluateRequest,
    EvaluateResponse,
    EvaluateSingleRequest,
    EvaluateSingleResponse,
    EvaluateCompareRequest,
    EvaluateCompareResponse,
)
from services.ai_service import evaluate
from services.evaluate_service import (
    evaluate_single,
    evaluate_compare,
)
from services.asr_service import NO_VOICE_MARKER

router = APIRouter(prefix="/api", tags=["evaluate"])


def _is_empty_or_no_voice(text: str) -> bool:
    """检查文本是否为空或无效转写。"""
    t = (text or "").strip()
    return not t or t == NO_VOICE_MARKER


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_attempts(req: EvaluateRequest):
    """对比改进前后的七维度双轨评价。"""
    if _is_empty_or_no_voice(req.attempt1_text) or _is_empty_or_no_voice(req.attempt2_text):
        return JSONResponse(
            status_code=422,
            content={
                "error": "empty_text",
                "message": "对话文本不能为空，请确保两次产出均包含有效语音内容。",
            },
        )
    result = evaluate(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
    )
    return result


@router.post("/evaluate-single", response_model=EvaluateSingleResponse)
async def evaluate_single_endpoint(req: EvaluateSingleRequest):
    """对单次对话进行国创七维能力评估。"""
    if _is_empty_or_no_voice(req.attempt_text):
        return JSONResponse(
            status_code=200,
            content={
                "error": "no_voice",
                "message": "未找到有效的初次产出语音内容，无法评估。",
                "dimension_scores": {},
                "comments": {},
            },
        )
    result = evaluate_single(
        conversation_text=req.attempt_text,
        task_context=req.task_context,
    )
    return result


@router.post("/evaluate-compare", response_model=EvaluateCompareResponse)
async def evaluate_compare_endpoint(req: EvaluateCompareRequest):
    """对比两次产出的国创七维双轨评价。"""
    if _is_empty_or_no_voice(req.attempt1_text) or _is_empty_or_no_voice(req.attempt2_text):
        return JSONResponse(
            status_code=200,
            content={
                "error": "no_voice",
                "message": "对比文本无效，请确保两次产出均包含有效语音内容。",
                "attempt1_scores": {},
                "attempt2_scores": {},
                "dimension_scores": {},
                "comparison": [],
            },
        )
    result = evaluate_compare(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
    )
    return result
