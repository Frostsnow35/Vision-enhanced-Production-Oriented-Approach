"""
促成学习路由 —— 根据诊断 Gap 生成精准学习材料，并写入数据库。
"""
import json
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from config import get_db
from models import Attempt, Gap as GapModel, InputPack
from services.facilitate_service import generate_materials, _mock_result

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facilitate_router")

router = APIRouter(prefix="/api/facilitate", tags=["facilitate"])


class GapItem(BaseModel):
    label: Optional[str] = None
    gap_label: Optional[str] = None
    evidence_sentence: Optional[str] = None
    evidence: Optional[str] = None
    explanation: Optional[str] = None
    suggestion: Optional[str] = None


class GenerateMaterialsRequest(BaseModel):
    task_id: int = 0
    gaps: List[GapItem] = []
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    attempt_number: int = 1


@router.post("/generate")
async def generate(req: GenerateMaterialsRequest, db: Session = Depends(get_db)):
    """
    根据诊断短板和场景上下文，调用 LLM 生成：
    - phrases: 场景词块与句式
    - dialogue: 示范对话
    - exercises: 即时练习
    LLM 失败时降级为 Mock 数据。
    生成后写入 InputPack 表供报告查询。
    """
    try:
        gaps = []
        for g in req.gaps:
            gaps.append({
                "label": g.label or g.gap_label or "",
                "evidence_sentence": g.evidence_sentence or g.evidence or "",
                "explanation": g.explanation or "",
            })

        result = generate_materials(
            gaps=gaps,
            scene_label=req.scene_label,
            roles=req.roles,
            goal=req.goal,
        )

        # ---- 保存 InputPack 到数据库 ----
        if req.task_id and req.task_id > 0 and result:
            try:
                attempt = db.query(Attempt).filter(
                    Attempt.task_id == req.task_id,
                    Attempt.attempt_number == 1
                ).order_by(Attempt.created_at.desc()).first()

                if attempt:
                    db_gaps = db.query(GapModel).filter(
                        GapModel.attempt_id == attempt.id
                    ).all()

                    for i, db_gap in enumerate(db_gaps):
                        # 检查是否已有 InputPack
                        existing = db.query(InputPack).filter(
                            InputPack.gap_id == db_gap.id
                        ).first()
                        if existing:
                            continue

                        pack = InputPack(
                            gap_id=db_gap.id,
                            task_id=req.task_id,
                            scene_chunks=json.dumps(result.get("phrases", []), ensure_ascii=False),
                            functional_sentences=json.dumps(result.get("dialogue", {}), ensure_ascii=False),
                            demo_dialogue=json.dumps(result.get("dialogue", {}).get("lines", []), ensure_ascii=False),
                            strategy_tip="",
                        )
                        db.add(pack)

                    db.commit()
                    logger.info(f"[facilitate] 已保存 {len(db_gaps)} 条 InputPack (task_id={req.task_id})")
            except Exception as e:
                db.rollback()
                logger.error(f"[facilitate] DB 保存失败: {e}")

        return result
    except Exception as e:
        logger.error(f"生成材料失败: {e}")
        return _mock_result()
