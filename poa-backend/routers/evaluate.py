"""
评价路由 —— 对比两次作答，返回七维度双轨评价结果。
"""
from fastapi import APIRouter

from schemas import EvaluateRequest, EvaluateResponse
from services.ai_service import evaluate

router = APIRouter(prefix="/api", tags=["evaluate"])


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_attempts(req: EvaluateRequest):
    """
    对比改进前（attempt1）和改进后（attempt2）的作答文本，
    返回七维度双轨评价：
    - dimension_scores: fluency / accuracy / pragmatics / complexity /
                         task_completion / vocabulary / pronunciation_intonation
    - problem_improved: 各问题改善情况
    - full_report: 完整综合评价报告
    """
    result = evaluate(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
    )
    return result
