"""
练习路由 —— 提交练习答案，本地判断对错。
当前为 Mock 实现，预置了正确答案和解释。
"""
from fastapi import APIRouter

from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["exercise"])


# ---- 请求体 ----
class SubmitExerciseRequest(BaseModel):
    question_id: int
    selected_answer: str


# ---- 响应体 ----
class SubmitExerciseResponse(BaseModel):
    correct: bool
    explanation: str


# ---- 预置题库 ----
_QUESTION_BANK = {
    1: {
        "answer": "B",
        "explanation": (
            "在英语服务场景中，'I'd like...' + 'please' 是最礼貌得体的表达方式。"
            "'I want...' 过于直接，'Give me...' 是命令式，显得粗鲁。"
        ),
    },
    2: {
        "answer": "C",
        "explanation": (
            "'For here, please.' 是最自然的回应：重复关键词 'for here' 表示确认，"
            "加上 'please' 保持礼貌。简短回答 'Here.' 虽然语法正确但显得冷淡。"
        ),
    },
    3: {
        "answer": "C",
        "explanation": (
            "'Sorry, could you say that again, please?' 是最得体的请求重复方式。"
            "'Sorry' 开头表示歉意，'Could' 委婉请求，'please' 结尾保持礼貌。"
            "单说 'What?' 在服务场景中非常粗鲁。"
        ),
    },
}


# ---- 接口 ----
@router.post("/submit-exercise", response_model=SubmitExerciseResponse)
async def submit_exercise(req: SubmitExerciseRequest):
    """
    提交练习答案，由后端判断对错并返回解释。
    """
    question = _QUESTION_BANK.get(req.question_id)

    if question is None:
        return SubmitExerciseResponse(
            correct=False,
            explanation="题目不存在",
        )

    is_correct = req.selected_answer.strip().upper() == question["answer"].upper()
    return SubmitExerciseResponse(
        correct=is_correct,
        explanation=question["explanation"],
    )
