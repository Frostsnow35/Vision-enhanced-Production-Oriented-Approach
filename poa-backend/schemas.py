"""
Pydantic 数据校验模型 —— 与 models.py 中的 6 张表一一对应。

每个表提供两类 schema：
  - Create：用于 POST / PUT 请求体校验，不含 auto-generated 字段（id, created_at）
  - Response：用于 API 返回数据序列化，包含所有字段，配置 from_attributes=True

此外还包含 API 路由专用的请求/响应模型。
"""
from datetime import datetime
from typing import Optional, Dict, Any, List

from pydantic import BaseModel


# ============================================================
# DB 表对应 schemas
# ============================================================

# --- Scenario ---
class ScenarioCreate(BaseModel):
    image_path: str
    scene_label: str


class ScenarioResponse(BaseModel):
    id: int
    image_path: str
    scene_label: str
    created_at: datetime
    model_config = {"from_attributes": True}


# --- POATask ---
class POATaskCreate(BaseModel):
    scenario_id: int
    roles: Optional[str] = None
    goal: Optional[str] = None
    context_constraints: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    variant_plot: Optional[str] = None
    opening_line: Optional[str] = None
    closing_line: Optional[str] = None


class POATaskResponse(BaseModel):
    id: int
    scenario_id: int
    roles: Optional[str] = None
    goal: Optional[str] = None
    context_constraints: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    variant_plot: Optional[str] = None
    opening_line: Optional[str] = None
    closing_line: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Attempt ---
class AttemptCreate(BaseModel):
    task_id: int
    attempt_number: int
    audio_path: Optional[str] = None
    text: Optional[str] = None


class AttemptResponse(BaseModel):
    id: int
    task_id: int
    attempt_number: int
    audio_path: Optional[str] = None
    text: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Gap ---
class GapCreate(BaseModel):
    attempt_id: int
    label: str
    evidence_sentence: Optional[str] = None
    explanation: Optional[str] = None


class GapResponse(BaseModel):
    id: int
    attempt_id: int
    label: str
    evidence_sentence: Optional[str] = None
    explanation: Optional[str] = None
    model_config = {"from_attributes": True}


# --- InputPack ---
class InputPackCreate(BaseModel):
    gap_id: int
    scene_chunks: Optional[str] = None
    functional_sentences: Optional[str] = None
    demo_dialogue: Optional[str] = None
    strategy_tip: Optional[str] = None
    task_id: Optional[int] = None


class InputPackResponse(BaseModel):
    id: int
    gap_id: int
    scene_chunks: Optional[str] = None
    functional_sentences: Optional[str] = None
    demo_dialogue: Optional[str] = None
    strategy_tip: Optional[str] = None
    task_id: Optional[int] = None
    model_config = {"from_attributes": True}


# --- Evaluation ---
class EvaluationCreate(BaseModel):
    attempt1_id: int
    attempt2_id: int
    dimension_scores: Optional[Dict[str, Any]] = None
    problem_improved: Optional[str] = None
    full_report: Optional[str] = None


class EvaluationResponse(BaseModel):
    id: int
    attempt1_id: int
    attempt2_id: int
    dimension_scores: Optional[Dict[str, Any]] = None
    problem_improved: Optional[str] = None
    full_report: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ============================================================
# API 路由专用 schemas
# ============================================================

# --- Scenario Analyze ---
class ScenarioAnalyzeRequest(BaseModel):
    """POST /api/scenario/analyze 请求体"""
    image_path: str


class ScenarioAnalyzeResponse(BaseModel):
    """POST /api/scenario/analyze 响应体"""
    scenario_id: Optional[int] = None
    task_id: Optional[int] = None
    scene_label: str
    roles: str
    goal: str
    context_constraints: str
    evaluation_criteria: str
    variant_plot: str


# --- Attempt Submit ---
class ConversationMessage(BaseModel):
    """对话中的一条消息"""
    role: str                                 # "user" | "ai"
    type: str                                 # "text" | "audio"
    content: str = ""                         # 文本内容（音频消息为占位符）
    audio_url: Optional[str] = None           # 音频文件路径（仅 type="audio" 时有值）


class AttemptSubmitRequest(BaseModel):
    """POST /api/attempt{1,2}/submit 请求体
    支持两种传参方式：
      1. 新格式: { task_id, scenario_id, conversation, attempt_number }
      2. 旧格式: { attempt_text }  ← 向后兼容
    """
    attempt_text: Optional[str] = None
    task_id: Optional[int] = None
    scenario_id: Optional[int] = None  # 用于自动查找对应的 task_id
    conversation: List[ConversationMessage] = []
    attempt_number: int = 1
    audio_path: Optional[str] = None  # 录音文件路径


class GapItem(BaseModel):
    """单条不足记录"""
    label: str
    evidence_sentence: Optional[str] = None
    explanation: Optional[str] = None
    reference_expression: Optional[str] = None


class HighFreqError(BaseModel):
    """高频错误短语（phrase-level）"""
    phrase: str
    occurrence: int = 1
    suggestion: str = ""


class AttemptSubmitResponse(BaseModel):
    """POST /api/attempt{1,2}/submit 响应体"""
    gaps: List[GapItem]
    high_freq_errors: List[HighFreqError] = []
    dimension_scores: dict = {}


# --- Generate InputPack ---
class InputPackGenerateRequest(BaseModel):
    """POST /api/generate-input-pack 请求体"""
    gaps: List[GapItem]


class ChunkItem(BaseModel):
    chunk: str
    meaning: str
    usage: str


class FunctionSentence(BaseModel):
    function: str
    sentence: str


class InputPackGenerateResponse(BaseModel):
    """POST /api/generate-input-pack 响应体"""
    scene_chunks: List[ChunkItem]
    functional_sentences: List[FunctionSentence]
    demo_dialogue: str
    strategy_tip: str


# --- Generate Exercises ---
class ExercisesGenerateRequest(BaseModel):
    """POST /api/generate-exercises 请求体"""
    gaps: List[GapItem]


class OptionItem(BaseModel):
    key: str
    text: str


class ExerciseItem(BaseModel):
    id: int
    type: str                                     # "multiple_choice" | "fill_in_blank"
    gap_target: str                               # 该题针对的不足标签
    question: str
    options: List[OptionItem] = []                 # 选择题的选项（填空题为空列表）
    answer: str                                   # 正确答案
    feedback: str                                 # 答题反馈


class ExercisesGenerateResponse(BaseModel):
    """POST /api/generate-exercises 响应体"""
    exercises: List[ExerciseItem]


# --- Evaluate ---
class EvaluateRequest(BaseModel):
    """POST /api/evaluate 请求体"""
    attempt1_text: str
    attempt2_text: str


class DimensionScore(BaseModel):
    """单维度前后对比分数（严格对齐 Excel 七维评分表）"""
    attempt1: float
    attempt2: float
    change: float
    weight: float
    comment: str = ""


class EvaluateResponse(BaseModel):
    """POST /api/evaluate 响应体（七维度）"""
    dimension_scores: Dict[str, DimensionScore]
    problem_improved: str
    full_report: str
