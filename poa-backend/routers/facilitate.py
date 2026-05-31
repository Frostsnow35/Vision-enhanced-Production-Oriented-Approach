"""
促成学习路由 —— 生成输入材料包和练习题。
"""
from fastapi import APIRouter

from schemas import (
    InputPackGenerateRequest,
    InputPackGenerateResponse,
    ExercisesGenerateRequest,
    ExercisesGenerateResponse,
)
from services.facilitate_service import generate_input_pack
from services.ai_service import generate_exercises

router = APIRouter(prefix="/api", tags=["facilitate"])


@router.post("/generate-input-pack", response_model=InputPackGenerateResponse)
async def gen_input_pack(req: InputPackGenerateRequest):
    """
    根据诊断不足列表（gaps），生成学习材料包：
    - scene_chunks: 场景词块
    - functional_sentences: 功能句式
    - demo_dialogue: 示范对话
    - strategy_tip: 学习策略提示
    """
    gaps_dicts = [g.model_dump() for g in req.gaps]
    result = generate_input_pack(gaps=gaps_dicts)
    return result


@router.post("/generate-exercises", response_model=ExercisesGenerateResponse)
async def gen_exercises(req: ExercisesGenerateRequest):
    """
    根据不足列表（gaps），生成 2~3 道针对性练习题。
    """
    gaps_dicts = [g.model_dump() for g in req.gaps]
    result = generate_exercises(gaps=gaps_dicts)
    return result
