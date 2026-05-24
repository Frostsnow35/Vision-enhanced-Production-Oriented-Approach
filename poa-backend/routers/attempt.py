"""
产出记录路由 —— 提交作答 + 诊断 + 获取补救材料 + 获取练习题。
"""
from fastapi import APIRouter

from schemas import (
    AttemptSubmitRequest,
    AttemptSubmitResponse,
    InputPackGenerateRequest,
    InputPackGenerateResponse,
    ExercisesGenerateRequest,
    ExercisesGenerateResponse,
)
from services.ai_service import (
    diagnose_attempt,
    generate_input_pack,
    generate_exercises,
)

router = APIRouter(prefix="/api", tags=["attempt"])


# === POST /api/attempt1/submit ===
@router.post("/attempt1/submit", response_model=AttemptSubmitResponse)
async def submit_attempt1(req: AttemptSubmitRequest):
    """
    提交第一次作答（改进前），AI 诊断并返回语言/语用不足列表（Gap）。
    请求参数：
    - attempt_text: 学生的作答文本（语音转写或直接输入）
    """
    result = diagnose_attempt(attempt_text=req.attempt_text)
    return result


# === POST /api/attempt2/submit ===
@router.post("/attempt2/submit", response_model=AttemptSubmitResponse)
async def submit_attempt2(req: AttemptSubmitRequest):
    """
    提交第二次作答（改进后），AI 诊断并返回剩余不足列表。
    参数与 attempt1 一致。
    """
    result = diagnose_attempt(attempt_text=req.attempt_text)
    return result


# === POST /api/generate-input-pack ===
@router.post("/generate-input-pack", response_model=InputPackGenerateResponse)
async def gen_input_pack(req: InputPackGenerateRequest):
    """
    根据诊断出的不足列表（gaps），生成针对性的学习材料包：
    - scene_chunks: 场景语块
    - functional_sentences: 功能句型
    - demo_dialogue: 示范对话
    - strategy_tip: 学习策略提示
    """
    gaps_dicts = [g.model_dump() for g in req.gaps]
    result = generate_input_pack(gaps=gaps_dicts)
    return result


# === POST /api/generate-exercises ===
@router.post("/generate-exercises", response_model=ExercisesGenerateResponse)
async def gen_exercises(req: ExercisesGenerateRequest):
    """
    根据不足列表（gaps），生成 2~3 道针对性练习题：
    - 选择题（multiple_choice）或 填空题（fill_in_blank）
    - 每题附带正确答案和详细反馈
    """
    gaps_dicts = [g.model_dump() for g in req.gaps]
    result = generate_exercises(gaps=gaps_dicts)
    return result
