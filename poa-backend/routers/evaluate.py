"""
评价路由 —— 单次能力评估 + 双轨对比评估。
"""
from fastapi import APIRouter
from pydantic import BaseModel

from schemas import EvaluateRequest, EvaluateResponse
from services.ai_service import evaluate as mock_evaluate
from services.evaluate_service import evaluate_single, evaluate_compare, evaluate_target_gaps

router = APIRouter(prefix="/api", tags=["evaluate"])


# ---- 请求/响应 schemas ----
class EvaluateSingleRequest(BaseModel):
    conversation_text: str = ""


class EvaluateSingleResponse(BaseModel):
    dimension_scores: dict


class EvaluateCompareRequest(BaseModel):
    attempt1_text: str = ""
    attempt2_text: str = ""
    gaps: list = []  # 可选：初次产出的诊断 gaps


class EvaluateCompareResponse(BaseModel):
    attempt1_scores: dict
    attempt2_scores: dict
    comparison: list
    target_evaluation: list = []  # 靶向评估结果（仅传入 gaps 时有值）


# ---- POST /api/evaluate（旧接口，保留兼容）----
@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_attempts(req: EvaluateRequest):
    """对比改进前后两次作答，返回七维度双轨评价。"""
    result = mock_evaluate(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
    )
    return result


# ---- POST /api/evaluate-single ----
@router.post("/evaluate-single", response_model=EvaluateSingleResponse)
async def eval_single(req: EvaluateSingleRequest):
    """
    对单次产出的对话文本进行七维能力评分（1-5 分）。
    七个维度：发音标准度、语法规范性、词汇适配性、
              语言功能达成度、语用策略得体性、话语回合适配性、副语言匹配度
    """
    result = evaluate_single(conversation_text=req.conversation_text)
    return result


# ---- POST /api/evaluate-compare ----
@router.post("/evaluate-compare", response_model=EvaluateCompareResponse)
async def eval_compare(req: EvaluateCompareRequest):
    """
    对比初次产出与二次产出的七维表现。
    返回双轨分数 + 各维度变化值 + 分析评语。
    如果传入 gaps，额外返回靶向评估（逐条判断每个 gap 是否改善）。
    """
    result = evaluate_compare(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
    )

    # 如果传入了 gaps，额外进行靶向评估
    target_evaluation = []
    if req.gaps:
        target_evaluation = evaluate_target_gaps(
            attempt1_text=req.attempt1_text,
            attempt2_text=req.attempt2_text,
            gaps=req.gaps,
        )

    return {
        **result,
        "target_evaluation": target_evaluation,
    }
