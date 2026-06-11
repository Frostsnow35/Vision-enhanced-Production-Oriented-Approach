"""
评价路由 —— 单次能力评估 + 双轨对比评估。
支持音频分析：传入 audio_paths 时，发音+副语言维度由本地 Whisper 分析。
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_db
from models import Attempt, Evaluation
from schemas import EvaluateRequest, EvaluateResponse
from services.ai_service import evaluate as mock_evaluate
from services.evaluate_service import evaluate_single, evaluate_compare, evaluate_target_gaps

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evaluate_router")

router = APIRouter(prefix="/api", tags=["evaluate"])


# ---- 请求/响应 schemas ----

class EvaluateSingleRequest(BaseModel):
    conversation_text: str = ""
    audio_paths: List[str] = []  # 音频文件路径列表（用于发音/流利度分析）


class EvaluateSingleResponse(BaseModel):
    dimension_scores: dict


class EvaluateCompareRequest(BaseModel):
    task_id: int = 0  # 用于关联 DB 中的 Attempt 记录
    attempt1_text: str = ""
    attempt2_text: str = ""
    audio1_paths: List[str] = []  # 初次产出音频路径列表
    audio2_paths: List[str] = []  # 二次产出音频路径列表
    gaps: list = []  # 可选：初次产出的诊断 gaps
    attempt1_scores: dict = {}  # 预计算的 attempt1 七维评分，传入后跳过重分析


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
async def eval_compare(req: EvaluateCompareRequest, db: Session = Depends(get_db)):
    """
    对比初次产出与二次产出的七维表现。
    如果传入了 attempt1_scores（预计算的七维评分），跳过 attempt1 重分析，
    仅评估 attempt2，然后与预计算分数对比。
    同时将 Evaluation 记录保存到数据库供报告查询。
    """
    audio1_paths = [p for p in req.audio1_paths if p] if req.audio1_paths else None
    audio2_paths = [p for p in req.audio2_paths if p] if req.audio2_paths else None

    # 如果有预计算的 attempt1 评分，只评估 attempt2 然后合并
    pre_scores = req.attempt1_scores
    if pre_scores and len(pre_scores) > 0:
        logger.info("[evaluate] 使用预计算 attempt1 评分，仅评估 attempt2")
        a2_result = evaluate_single(
            conversation_text=req.attempt2_text,
            audio_paths=audio2_paths,
        )
        a2_scores = a2_result.get("dimension_scores", {})

        # 构建 comparison
        dims = ["发音标准度","语法规范性","词汇适配性","语言功能达成度","语用策略得体性","话语回适合配性","副语言匹配度"]
        comparison = []
        a1_out = {}
        a2_out = {}
        dim_scores = {}
        for d in dims:
            a1 = float(pre_scores.get(d, 2.5))
            a2 = float(a2_scores.get(d, 2.5))
            change = round(a2 - a1, 1)
            a1_out[d] = a1
            a2_out[d] = a2
            comparison.append({
                "dimension": d,
                "attempt1_score": a1,
                "attempt2_score": a2,
                "change": f"{'+' if change >= 0 else ''}{change}",
                "comment": a2_result.get("comments", {}).get(d, ""),
            })
            dim_scores[d] = {"attempt1": a1, "attempt2": a2, "change": change}

        result = {
            "attempt1_scores": a1_out,
            "attempt2_scores": a2_out,
            "dimension_scores": dim_scores,
            "comparison": comparison,
        }
    else:
        result = evaluate_compare(
            attempt1_text=req.attempt1_text,
            attempt2_text=req.attempt2_text,
            audio1_paths=audio1_paths,
            audio2_paths=audio2_paths,
        )

    # 靶向评估
    target_evaluation = []
    if req.gaps:
        target_evaluation = evaluate_target_gaps(
            attempt1_text=req.attempt1_text,
            attempt2_text=req.attempt2_text,
            gaps=req.gaps,
        )

    # ---- 保存 Evaluation 到数据库 ----
    task_id = req.task_id
    # 兜底：没传 task_id 时，从最新的 attempt2 反查
    if not task_id or task_id <= 0:
        latest_a2 = db.query(Attempt).filter(
            Attempt.attempt_number == 2
        ).order_by(Attempt.created_at.desc()).first()
        if latest_a2:
            task_id = latest_a2.task_id
            logger.info(f"[evaluate] 未传 task_id，从最新 attempt2 反查到 task_id={task_id}")

    if task_id and task_id > 0:
        try:
            a1 = db.query(Attempt).filter(
                Attempt.task_id == task_id, Attempt.attempt_number == 1
            ).order_by(Attempt.created_at.desc()).first()
            a2 = db.query(Attempt).filter(
                Attempt.task_id == task_id, Attempt.attempt_number == 2
            ).order_by(Attempt.created_at.desc()).first()

            if a1 and a2:
                # 检查是否已有 evaluation
                existing = db.query(Evaluation).filter(
                    Evaluation.attempt1_id == a1.id, Evaluation.attempt2_id == a2.id
                ).first()
                if not existing:
                    dims = result.get("dimension_scores", {})
                    ev = Evaluation(
                        attempt1_id=a1.id, attempt2_id=a2.id,
                        dimension_scores=dims,
                        problem_improved=result.get("comparison", []),
                        full_report="\n".join([
                            f"{d.get('dimension','')}: {d.get('comment','')}"
                            for d in result.get("comparison", [])
                        ]),
                    )
                    db.add(ev)
                    db.commit()
                    logger.info(f"[evaluate] 已保存 Evaluation (attempt1={a1.id}, attempt2={a2.id})")
        except Exception as e:
            db.rollback()
            logger.error(f"[evaluate] 保存 Evaluation 失败: {e}")

    return {
        **result,
        "target_evaluation": target_evaluation,
    }
