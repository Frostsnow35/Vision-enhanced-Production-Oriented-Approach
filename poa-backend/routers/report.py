"""
报告路由 —— 按 scenario_id 获取完整学习闭环数据。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import get_db
from services.report_service import get_report

router = APIRouter(prefix="/api/report", tags=["report"])


@router.get("/{run_id}")

async def get_run_report(run_id: int, db: Session = Depends(get_db)):
    """
    获取指定 run_id（即 scenario_id）对应的完整学习闭环报告。
    包含：场景 → 任务 → 两次产出 → 诊断不足 → 学习材料 → 评价结果。
    """
    report = get_report(scenario_id=run_id, db=db)

    if not report or "scenario" not in report or report["scenario"] is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} 不存在")

    return report
