"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。
"""
import logging
import os
import time

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config import get_db, DOUBAO_API_KEY, DOUBAO_BASE_URL, ARK_MODEL_ID
from schemas import ScenarioAnalyzeRequest, ScenarioAnalyzeResponse, VLMHealthResponse
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


@router.get("/health", response_model=VLMHealthResponse)
async def health():
    """检查豆包 VLM API 连通性"""
    if not DOUBAO_API_KEY:
        return {
            "vlm_available": False,
            "error_type": "api_key_missing",
            "detail": "DOUBAO_API_KEY not configured",
        }

    try:
        start = time.time()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{DOUBAO_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": ARK_MODEL_ID,
                    "messages": [
                        {"role": "user", "content": "ping"}
                    ],
                },
            )
        elapsed = int((time.time() - start) * 1000)
        if resp.status_code == 200:
            return {
                "vlm_available": True,
                "model": ARK_MODEL_ID,
                "latency_ms": elapsed,
            }
        else:
            return {
                "vlm_available": False,
                "model": ARK_MODEL_ID,
                "latency_ms": elapsed,
                "error_type": "http_error",
                "detail": f"HTTP {resp.status_code}: {resp.text[:200]}",
            }
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return {
            "vlm_available": False,
            "model": ARK_MODEL_ID,
            "latency_ms": elapsed,
            "error_type": type(e).__name__,
            "detail": str(e),
        }
