from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.models import get_db
from app.schemas import schemas
from app.services.poa_service import poa_service
from typing import Dict, Any

router = APIRouter(prefix="/poa", tags=["POA Learning"])

@router.post("/generate-task", response_model=schemas.TaskGenerationResponse)
async def generate_task(photo_url: str, db: Session = Depends(get_db)):
    result = poa_service.generate_task(db, photo_url)
    if result["success"]:
        scenario = result["scenario"]
        task = result["task"]
        return schemas.TaskGenerationResponse(
            success=True,
            scenario=schemas.ScenarioResponse(
                id=scenario.id,
                photo_url=scenario.photo_url,
                tags=scenario.tags,
                created_at=scenario.created_at
            ),
            task=schemas.POATaskResponse(
                id=task.id,
                scenario_id=task.scenario_id,
                your_role=task.your_role,
                ai_role=task.ai_role,
                goal=task.goal,
                constraints=task.constraints,
                evaluation_criteria=task.evaluation_criteria,
                created_at=task.created_at
            )
        )
    else:
        return schemas.TaskGenerationResponse(success=False, error=result["error"])

@router.post("/attempt", response_model=schemas.AttemptResponse)
async def create_attempt(
    attempt_create: schemas.AttemptCreate,
    db: Session = Depends(get_db)
):
    attempt = poa_service.create_attempt(
        db,
        poa_task_id=attempt_create.poa_task_id,
        attempt_number=attempt_create.attempt_number,
        audio_url=attempt_create.audio_url,
        transcript=attempt_create.transcript,
        turns=attempt_create.turns
    )
    return schemas.AttemptResponse(
        id=attempt.id,
        poa_task_id=attempt.poa_task_id,
        attempt_number=attempt.attempt_number,
        audio_url=attempt.audio_url,
        transcript=attempt.transcript,
        turns=attempt.turns,
        created_at=attempt.created_at
    )

@router.post("/diagnose/{attempt_id}", response_model=schemas.DiagnosisResponse)
async def diagnose_attempt(attempt_id: str, db: Session = Depends(get_db)):
    result = poa_service.diagnose_attempt(db, attempt_id)
    if result["success"]:
        gaps = [
            schemas.GapResponse(
                id=gap["id"],
                type=gap["type"],
                evidence=gap["evidence"],
                consequence=gap["consequence"],
                target_improvement=gap["target_improvement"]
            )
            for gap in result["gaps"]
        ]
        return schemas.DiagnosisResponse(success=True, gaps=gaps)
    else:
        raise HTTPException(status_code=400, detail=result["error"])

@router.post("/generate-input/{attempt_id}", response_model=schemas.InputPackGenerationResponse)
async def generate_input(attempt_id: str, db: Session = Depends(get_db)):
    result = poa_service.generate_input(db, attempt_id)
    if result["success"]:
        input_pack = result["input_pack"]
        exercises = [
            schemas.ExerciseResponse(
                id=ex["id"],
                question=ex["question"],
                options=ex["options"],
                correct_answer=ex["correct_answer"],
                explanation=ex["explanation"]
            )
            for ex in result["exercises"]
        ]
        return schemas.InputPackGenerationResponse(
            success=True,
            input_pack=schemas.InputPackResponse(
                id="input-" + attempt_id,
                vocabulary=input_pack["vocabulary"],
                patterns=input_pack["patterns"],
                model_dialogue=input_pack["model_dialogue"],
                strategies=input_pack["strategies"],
                created_at=input_pack.get("created_at") or "2024-01-01T00:00:00"
            ),
            exercises=exercises
        )
    else:
        raise HTTPException(status_code=400, detail=result["error"])

@router.post("/evaluate", response_model=schemas.EvaluationResponse)
async def evaluate(
    request: schemas.EvaluationRequest,
    db: Session = Depends(get_db)
):
    result = poa_service.evaluate(db, request.attempt1_id, request.attempt2_id)
    if result["success"]:
        evaluation = result["evaluation"]
        return schemas.EvaluationResponse(
            id="eval-" + request.attempt1_id,
            poa_task_id="task-" + request.attempt1_id[:8],
            attempt1_id=request.attempt1_id,
            attempt2_id=request.attempt2_id,
            seven_dimension_scores=evaluation["seven_dimension_scores"],
            gap_improvements=evaluation["gap_improvements"],
            overall_judgment=evaluation["overall_judgment"],
            created_at="2024-01-01T00:00:00"
        )
    else:
        raise HTTPException(status_code=400, detail=result["error"])

@router.get("/report/{poa_task_id}", response_model=schemas.ReportResponse)
async def get_report(poa_task_id: str, db: Session = Depends(get_db)):
    result = poa_service.get_report(db, poa_task_id)
    if result["success"]:
        return schemas.ReportResponse(
            id="report-" + poa_task_id,
            poa_task_id=poa_task_id,
            data=result["report"],
            created_at="2024-01-01T00:00:00"
        )
    else:
        raise HTTPException(status_code=404, detail=result["error"])