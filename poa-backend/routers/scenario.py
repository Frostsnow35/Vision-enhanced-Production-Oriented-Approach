"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。
"""
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import get_db
from schemas import ScenarioAnalyzeRequest, ScenarioAnalyzeResponse
from services.ai_service import get_or_analyze_scenario

router = APIRouter(prefix="/api/scenario", tags=["scenario"])

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@router.post("/analyze", response_model=ScenarioAnalyzeResponse)
async def analyze_scene(req: ScenarioAnalyzeRequest, db: Session = Depends(get_db)):
    image_path = req.image_path
    if not os.path.isabs(image_path):
        image_path = os.path.join(BACKEND_ROOT, image_path)
    image_path = os.path.normpath(image_path)

    result = get_or_analyze_scenario(image_path=image_path, db=db)
    return result
