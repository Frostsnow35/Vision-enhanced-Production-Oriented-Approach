"""
评价路由 —— 单次能力评估 + 双轨对比评估。
支持音频分析：传入 audio_paths 时，发音+副语言维度由本地 Whisper 分析。
"""
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from schemas import EvaluateRequest, EvaluateResponse
from services.ai_service import evaluate as mock_evaluate
from services.evaluate_service import evaluate_single, evaluate_compare, evaluate_target_gaps

router = APIRouter(prefix="/api", tags=["evaluate"])


# ---- 请求/响应 schemas ----

class EvaluateSingleRequest(BaseModel):
    conversation_text: str = ""
    audio_paths: List[str] = []  # 音频文件路径列表（用于发音/流利度分析）


class EvaluateSingleResponse(BaseModel):
    dimension_scores: dict


class EvaluateCompareRequest(BaseModel):
    attempt1_text: str = ""
    attempt2_text: str = ""
    audio1_paths: List[str] = []  # 初次产出音频路径列表
    audio2_paths: List[str] = []  # 二次产出音频路径列表
    gaps: list = []  # 可选：初次产出的诊断 gaps


class EvaluateCompareResponse(BaseModel):
    attempt1_scores: dict
    attempt2_scores: dict
    dimension_scores: dict = {}  # 七维评分（含 weight/comment/change）严格对齐 Excel
    comparison: list
    target_evaluation: list = []  # 靶向评估结果（仅传入 gaps 时有值）
    audio_analysis: dict = {}  # 音频分析原始指标


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
    如传入 audio_paths，发音标准度和副语言匹配度由本地音频分析给出真实分数。
    """
    audio_paths = [p for p in req.audio_paths if p] if req.audio_paths else None
    result = evaluate_single(
        conversation_text=req.conversation_text,
        audio_paths=audio_paths,
    )
    return result


# ---- POST /api/evaluate-compare ----
@router.post("/evaluate-compare", response_model=EvaluateCompareResponse)
async def eval_compare(req: EvaluateCompareRequest):
    """
    对比初次产出与二次产出的七维表现。
    返回双轨分数 + 各维度变化值 + 分析评语。
    如传入 audio1_paths/audio2_paths，发音+副语言由音频分析给出。
    如果传入 gaps，额外返回靶向评估（逐条判断每个 gap 是否改善）。
    """
    audio1_paths = [p for p in req.audio1_paths if p] if req.audio1_paths else None
    audio2_paths = [p for p in req.audio2_paths if p] if req.audio2_paths else None

    result = evaluate_compare(
        attempt1_text=req.attempt1_text,
        attempt2_text=req.attempt2_text,
        audio1_paths=audio1_paths,
        audio2_paths=audio2_paths,
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
