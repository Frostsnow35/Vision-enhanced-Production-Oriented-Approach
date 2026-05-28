"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。
"""
import logging
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import get_db
from schemas import ScenarioAnalyzeRequest, ScenarioAnalyzeResponse
from services.ai_service import get_or_analyze_scenario

router = APIRouter(prefix="/api/scenario", tags=["scenario"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scenario")

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_ROOT = os.path.join(BACKEND_ROOT, "uploads")


@router.post("/analyze", response_model=ScenarioAnalyzeResponse)
async def analyze_scene(req: ScenarioAnalyzeRequest, db: Session = Depends(get_db)):
    image_path = req.image_path
    logger.info(f"[analyze_scene] 收到请求: {image_path}")
    
    if not os.path.isabs(image_path):
        candidates = [
            os.path.join(UPLOAD_ROOT, image_path),
            os.path.join("/tmp/poa_uploads", image_path),
            os.path.join(BACKEND_ROOT, image_path),
            image_path,
        ]
        
        for candidate in candidates:
            candidate = os.path.normpath(candidate)
            if os.path.exists(candidate):
                image_path = candidate
                logger.info(f"[analyze_scene] 找到文件: {image_path}")
                break
        
        if not os.path.exists(image_path):
            logger.error(f"[analyze_scene] 文件不存在: {image_path}")
            logger.error(f"[analyze_scene] 尝试路径: {candidates}")
    
    image_path = os.path.normpath(image_path)
    logger.info(f"[analyze_scene] 最终路径: {image_path}")

    result = get_or_analyze_scenario(image_path=image_path, db=db)
    return result
