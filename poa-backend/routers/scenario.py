"""
场景路由 —— 上传场景图片后，AI 分析并返回场景要素 + POA 任务参数。
使用 MD5 哈希缓存，同一张图片不会重复调用 VLM。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import get_db
from schemas import ScenarioAnalyzeRequest, ScenarioAnalyzeResponse
from services.ai_service import get_or_analyze_scenario

router = APIRouter(prefix="/api/scenario", tags=["scenario"])


@router.post("/analyze", response_model=ScenarioAnalyzeResponse)
async def analyze_scene(req: ScenarioAnalyzeRequest, db: Session = Depends(get_db)):
    """
    接收场景图片路径，优先从数据库缓存读取；
    缓存未命中时调用豆包视觉模型分析并自动存入数据库。
    返回：
    - scene_label: 场景标签
    - roles: 角色描述
    - goal: 交际目标
    - context_constraints: 场景约束
    - evaluation_criteria: 评价标准
    - variant_plot: 变体情节
    """
    # 如果前端传的是 /samples/xxx.jpg，映射到本地 sample_images/ 目录
    image_path = req.image_path
    if image_path.startswith("/samples/"):
        image_path = "sample_images/" + image_path[len("/samples/"):]

    result = get_or_analyze_scenario(image_path=image_path, db=db)
    return result
