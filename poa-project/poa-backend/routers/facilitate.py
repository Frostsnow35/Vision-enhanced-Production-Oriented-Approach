"""
促成学习路由 —— 根据诊断 Gap 生成精准学习材料。
"""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

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
    gaps: List[GapItem] = []
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    attempt_number: int = 1


@router.post("/generate")
async def generate(req: GenerateMaterialsRequest):
    """
    根据诊断短板和场景上下文，调用 LLM 生成：
    - phrases: 场景词块与句式
    - dialogue: 示范对话
    - exercises: 即时练习
    LLM 失败时降级为 Mock 数据。
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
        return result
    except Exception as e:
        logger.error(f"生成材料失败: {e}")
        return _mock_result()
