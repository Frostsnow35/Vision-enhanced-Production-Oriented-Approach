"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。
"""
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import get_db, UPLOAD_DIR, BACKEND_PUBLIC_URL
from schemas import ScenarioAnalyzeRequest, ScenarioAnalyzeResponse
from services.ai_service import get_or_analyze_scenario

router = APIRouter(prefix="/api/scenario", tags=["scenario"])


def _build_public_url(file_path: str) -> str:
    """根据本地文件路径构造公网可访问的图片 URL（供 Ark VLM 下载）。"""
    if not BACKEND_PUBLIC_URL:
        return ""
    # file_path 如 /data/uploads/images/xxx.jpg → 提取 uploads/images/xxx.jpg
    norm = file_path.replace("\\", "/")
    marker = "uploads/"
    idx = norm.find(marker)
    if idx >= 0:
        return f"{BACKEND_PUBLIC_URL}/{norm[idx:]}"
    return ""


@router.post("/analyze", response_model=ScenarioAnalyzeResponse)

async def analyze_scene(req: ScenarioAnalyzeRequest, db: Session = Depends(get_db)):
    """
    接收场景图片路径，优先从数据库缓存读取；
    缓存未命中时调用豆包视觉模型分析并自动存入数据库。
    """
    image_path = req.image_path
    if image_path.startswith("/"):
        image_path = image_path[1:]

    # 将 URL 路径映射到文件系统路径
    # 本地: uploads/images/xxx.jpg 或 /data/uploads/images/xxx.jpg
    if not os.path.isfile(image_path):
        resolved = os.path.join(UPLOAD_DIR, image_path.replace("uploads/", "", 1) if "uploads/" in image_path else image_path)
        if os.path.isfile(resolved):
            image_path = resolved

    # 构造公网 URL（优先用 URL 传图，避免跨太平洋传输 base64 大体积数据）
    image_url = _build_public_url(image_path)

    try:
        result = get_or_analyze_scenario(image_path=image_path, db=db, image_url=image_url)
        # 预生成开场白 TTS（缓存预热），让 /api/chat/start 秒返回语音
        opening = result.get("opening_line", "")
        if opening:
            try:
                from services.chat_service import text_to_speech
                text_to_speech(opening)
            except Exception:
                pass
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": "scene_analysis_failed", "message": str(e)},
        )
