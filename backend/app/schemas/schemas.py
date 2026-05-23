from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Dict, Any

class ScenarioCreate(BaseModel):
    photo_url: str
    tags: Optional[List[str]] = []

class ScenarioResponse(BaseModel):
    id: str
    photo_url: str
    tags: List[str]
    created_at: datetime

class POATaskCreate(BaseModel):
    scenario_id: str
    your_role: str
    ai_role: str
    goal: str
    constraints: List[str]
    evaluation_criteria: List[str]

class POATaskResponse(BaseModel):
    id: str
    scenario_id: str
    your_role: str
    ai_role: str
    goal: str
    constraints: List[str]
    evaluation_criteria: List[str]
    created_at: datetime

class Turn(BaseModel):
    speaker: str
    text: str
    timestamp: datetime

class AttemptCreate(BaseModel):
    poa_task_id: str
    attempt_number: int
    audio_url: Optional[str] = None
    transcript: Optional[str] = None
    turns: Optional[List[Dict[str, Any]]] = []

class AttemptResponse(BaseModel):
    id: str
    poa_task_id: str
    attempt_number: int
    audio_url: Optional[str]
    transcript: Optional[str]
    turns: List[Dict[str, Any]]
    created_at: datetime

class GapResponse(BaseModel):
    id: str
    type: str
    evidence: str
    consequence: str
    target_improvement: str
    improvement_score: Optional[float]

class InputPackResponse(BaseModel):
    id: str
    vocabulary: List[Dict[str, str]]
    patterns: List[str]
    model_dialogue: List[Dict[str, str]]
    strategies: List[str]
    created_at: datetime

class ExerciseResponse(BaseModel):
    id: str
    question: str
    options: List[str]
    correct_answer: int
    explanation: str

class EvaluationResponse(BaseModel):
    id: str
    poa_task_id: str
    attempt1_id: str
    attempt2_id: str
    seven_dimension_scores: List[Dict[str, float]]
    gap_improvements: List[Dict[str, Any]]
    overall_judgment: str
    created_at: datetime

class ReportResponse(BaseModel):
    id: str
    poa_task_id: str
    data: Dict[str, Any]
    created_at: datetime

class TaskGenerationResponse(BaseModel):
    success: bool
    task: Optional[POATaskResponse] = None
    scenario: Optional[ScenarioResponse] = None
    error: Optional[str] = None

class DiagnosisResponse(BaseModel):
    success: bool
    gaps: List[GapResponse] = []
    error: Optional[str] = None

class InputPackGenerationResponse(BaseModel):
    success: bool
    input_pack: Optional[InputPackResponse] = None
    exercises: List[ExerciseResponse] = []
    error: Optional[str] = None

class EvaluationRequest(BaseModel):
    attempt1_id: str
    attempt2_id: str

class PresignedUrlResponse(BaseModel):
    success: bool
    upload_url: Optional[str] = None
    photo_url: Optional[str] = None
    error: Optional[str] = None

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None