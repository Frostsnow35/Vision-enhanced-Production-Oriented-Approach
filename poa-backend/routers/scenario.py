"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。

采用「触发 + 轮询」模式适配移动端：
- POST /analyze 立即返回 task_id，后台异步执行 VLM 分析
- GET /status/{task_id} 前端轮询结果（2s 间隔）
- 避免手机端浏览器/运营商代理杀死 >60s 的长连接
"""
import os
import uuid
import time
import threading
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import get_db, UPLOAD_DIR, BACKEND_PUBLIC_URL
from schemas import ScenarioAnalyzeRequest

logger = logging.getLogger("poa.scenario")
router = APIRouter(prefix="/api/scenario", tags=["scenario"])

# ---- 异步任务存储（内存字典 + TTL 自动清理）----
_analysis_tasks: Dict[str, Dict[str, Any]] = {}
_TASK_TTL = 600  # 任务结果保留 10 分钟


def _evict_expired_tasks():
    """清理过期任务。"""
    now = time.time()
    expired = [tid for tid, t in _analysis_tasks.items() if now - t.get("_created", 0) > _TASK_TTL]
    for tid in expired:
        del _analysis_tasks[tid]
    if expired:
        logger.info(f"[async] 清理 {len(expired)} 个过期任务")


def _build_public_url(file_path: str) -> str:
    """根据本地文件路径构造公网可访问的图片 URL（供 Ark VLM 下载）。"""
    if not BACKEND_PUBLIC_URL:
        return ""
    norm = file_path.replace("\\", "/")
    marker = "uploads/"
    idx = norm.find(marker)
    if idx >= 0:
        return f"{BACKEND_PUBLIC_URL}/{norm[idx:]}"
    return ""


def _resolve_image_path(raw_path: str) -> str:
    """将前端传入的 URL 路径解析为服务器本地文件路径。"""
    image_path = raw_path
    if image_path.startswith("/"):
        image_path = image_path[1:]
    if not os.path.isfile(image_path):
        resolved = os.path.join(UPLOAD_DIR, image_path.replace("uploads/", "", 1) if "uploads/" in image_path else image_path)
        if os.path.isfile(resolved):
            image_path = resolved
    return image_path


def _run_analysis_bg(task_id: str, image_path: str, image_url: str):
    """后台线程：执行 VLM 场景分析，完成后写入 _analysis_tasks。"""
    from config import SessionLocal
    from services.ai_service import get_or_analyze_scenario
    db = SessionLocal()
    try:
        result = get_or_analyze_scenario(image_path=image_path, db=db, image_url=image_url)
        _analysis_tasks[task_id] = {"status": "completed", "result": result, "_created": time.time()}
        logger.info(f"[async] task={task_id[:8]} 完成")

        # 预生成开场白 TTS
        opening = result.get("opening_line", "")
        if opening:
            try:
                from services.chat_service import text_to_speech
                text_to_speech(opening)
            except Exception:
                pass
    except Exception as e:
        import traceback
        traceback.print_exc()
        _analysis_tasks[task_id] = {"status": "failed", "error": str(e), "_created": time.time()}
        logger.error(f"[async] task={task_id[:8]} 失败: {e}")
    finally:
        db.close()


@router.post("/analyze")
async def analyze_scene(req: ScenarioAnalyzeRequest):
    """
    异步触发场景分析，立即返回 task_id。
    前端通过 GET /api/scenario/status/{task_id} 轮询结果。
    """
    _evict_expired_tasks()

    image_path = _resolve_image_path(req.image_path)
    image_url = _build_public_url(image_path)

    task_id = str(uuid.uuid4())
    _analysis_tasks[task_id] = {"status": "processing", "_created": time.time()}
    logger.info(f"[async] task={task_id[:8]} 已创建, image_path={image_path[:60]}")

    thread = threading.Thread(target=_run_analysis_bg, args=(task_id, image_path, image_url), daemon=True)
    thread.start()

    return {"task_id": task_id, "status": "processing"}


@router.get("/status/{task_id}")
async def get_analysis_status(task_id: str):
    """轮询场景分析结果。返回 {status, result?} 或 {status, error?}。"""
    task = _analysis_tasks.get(task_id)
    if not task:
        return {"status": "not_found"}
    # 返回时剥离内部字段
    return {k: v for k, v in task.items() if not k.startswith("_")}
