"""
报告服务 —— 按 scenario_id 聚合所有学习闭环数据。
包含 TTL 内存缓存：同一 scenario_id 30 分钟内只查一次数据库。
"""
import logging
import time
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from models import Scenario, POATask, Attempt, Gap, InputPack, Evaluation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("report_service")

# ---- TTL 缓存 ----
_CACHE_TTL_SECONDS = 30 * 60  # 30 分钟

# 缓存格式: { scenario_id: (report_dict, timestamp) }
_cache: Dict[int, tuple[Dict[str, Any], float]] = {}


def _model_to_dict(obj: Any, exclude: Optional[set] = None) -> Dict[str, Any]:
    """ORM 对象 → 字典。"""
    skip = exclude or set()
    result = {}
    for c in obj.__table__.columns:
        if c.key in skip:
            continue
        val = getattr(obj, c.key)
        if hasattr(val, "isoformat"):
            val = val.isoformat()
        result[c.key] = val
    return result


def get_report(scenario_id: int, db: Session) -> Dict[str, Any]:
    """
    根据 scenario_id 聚合学习闭环的所有数据。
    命中有效缓存直接返回，否则查询数据库后缓存（TTL 30 分钟）。
    """
    # 检查 TTL 缓存
    now = time.time()
    if scenario_id in _cache:
        cached, ts = _cache[scenario_id]
        if now - ts < _CACHE_TTL_SECONDS:
            logger.info(f"[report] 缓存命中 — scenario_id={scenario_id} ({(now - ts):.0f}s ago)")
            return cached
        else:
            logger.info(f"[report] 缓存已过期 — scenario_id={scenario_id}")
            _cache.pop(scenario_id, None)

    t0 = time.time()
    logger.info(f"[report] 查询数据库 — scenario_id={scenario_id}")

    # ---- 1. Scenario ----
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if scenario is None:
        return {}

    # ---- 2. POATask（取第一个任务）----
    task = (
        db.query(POATask)
        .filter(POATask.scenario_id == scenario_id)
        .order_by(POATask.created_at.asc())
        .first()
    )

    # ---- 3. Attempts ----
    attempts = []
    if task is not None:
        attempts = (
            db.query(Attempt)
            .filter(Attempt.task_id == task.id)
            .order_by(Attempt.attempt_number.asc())
            .all()
        )

    a1 = next((a for a in attempts if a.attempt_number == 1), None)
    a2 = next((a for a in attempts if a.attempt_number == 2), None)

    # ---- 4. Gaps ----
    gaps_a1 = db.query(Gap).filter(Gap.attempt_id == a1.id).all() if a1 else []
    gaps_a2 = db.query(Gap).filter(Gap.attempt_id == a2.id).all() if a2 else []

    # ---- 5. InputPack ----
    input_packs = []
    for g in gaps_a1:
        packs = db.query(InputPack).filter(InputPack.gap_id == g.id).all()
        input_packs.extend(packs)

    # ---- 6. Evaluation ----
    evaluation = None
    if a1 is not None and a2 is not None:
        evaluation = (
            db.query(Evaluation)
            .filter(
                Evaluation.attempt1_id == a1.id,
                Evaluation.attempt2_id == a2.id,
            )
            .order_by(Evaluation.created_at.desc())
            .first()
        )

    # ---- 组装 ----
    report = {
        "run_id": scenario_id,
        "scenario": _model_to_dict(scenario) if scenario else None,
        "task": _model_to_dict(task) if task else None,
        "attempt1": _model_to_dict(a1) if a1 else None,
        "attempt2": _model_to_dict(a2) if a2 else None,
        "diagnosis": {"gaps": [_model_to_dict(g) for g in gaps_a1]},
        "diagnosis_attempt2": {"gaps": [_model_to_dict(g) for g in gaps_a2]},
        "facilitation": {"input_packs": [_model_to_dict(p) for p in input_packs]},
        "evaluation": _model_to_dict(evaluation) if evaluation else None,
    }

    _cache[scenario_id] = (report, now)
    elapsed = time.time() - t0
    logger.info(f"[report] 已缓存 — scenario_id={scenario_id} (查询耗时 {elapsed:.2f}s)")

    return report


def invalidate_cache(scenario_id: Optional[int] = None) -> None:
    """清除缓存。不传参数则清空全部。"""
    if scenario_id is not None:
        _cache.pop(scenario_id, None)
        logger.info(f"[report] 缓存已清除 — scenario_id={scenario_id}")
    else:
        _cache.clear()
        logger.info("[report] 全部缓存已清除")
