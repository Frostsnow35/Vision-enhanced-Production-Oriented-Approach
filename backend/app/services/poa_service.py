import uuid
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models import models
from app.schemas import schemas
from app.services.ai_service import ai_service
from datetime import datetime

class POAService:
    def create_scenario(self, db: Session, photo_url: str, tags: List[str] = []) -> models.Scenario:
        scenario = models.Scenario(
            id=str(uuid.uuid4()),
            photo_url=photo_url,
            tags=tags,
            created_at=datetime.utcnow()
        )
        db.add(scenario)
        db.commit()
        db.refresh(scenario)
        return scenario
    
    def create_poa_task(self, db: Session, scenario_id: str, task_data: Dict[str, Any]) -> models.POATask:
        task = models.POATask(
            id=str(uuid.uuid4()),
            scenario_id=scenario_id,
            your_role=task_data["your_role"],
            ai_role=task_data["ai_role"],
            goal=task_data["goal"],
            constraints=task_data["constraints"],
            evaluation_criteria=task_data["evaluation_criteria"],
            created_at=datetime.utcnow()
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return task
    
    def create_attempt(self, db: Session, poa_task_id: str, attempt_number: int, 
                      audio_url: Optional[str] = None, transcript: Optional[str] = None,
                      turns: List[Dict[str, Any]] = []) -> models.Attempt:
        attempt = models.Attempt(
            id=str(uuid.uuid4()),
            poa_task_id=poa_task_id,
            attempt_number=attempt_number,
            audio_url=audio_url,
            transcript=transcript,
            turns=turns,
            created_at=datetime.utcnow()
        )
        db.add(attempt)
        db.commit()
        db.refresh(attempt)
        return attempt
    
    def create_gaps(self, db: Session, attempt_id: str, gaps_data: List[Dict[str, Any]]) -> List[models.Gap]:
        gaps = []
        for gap_data in gaps_data:
            gap = models.Gap(
                id=gap_data.get("id", str(uuid.uuid4())),
                attempt_id=attempt_id,
                type=gap_data["type"],
                evidence=gap_data["evidence"],
                consequence=gap_data["consequence"],
                target_improvement=gap_data["target_improvement"]
            )
            gaps.append(gap)
            db.add(gap)
        db.commit()
        return gaps
    
    def create_input_pack(self, db: Session, attempt_id: str, input_data: Dict[str, Any]) -> models.InputPack:
        input_pack = models.InputPack(
            id=str(uuid.uuid4()),
            attempt_id=attempt_id,
            vocabulary=input_data["vocabulary"],
            patterns=input_data["patterns"],
            model_dialogue=input_data["model_dialogue"],
            strategies=input_data["strategies"],
            created_at=datetime.utcnow()
        )
        db.add(input_pack)
        db.commit()
        db.refresh(input_pack)
        return input_pack
    
    def create_exercises(self, db: Session, input_pack_id: str, exercises_data: List[Dict[str, Any]]) -> List[models.Exercise]:
        exercises = []
        for ex_data in exercises_data:
            exercise = models.Exercise(
                id=ex_data.get("id", str(uuid.uuid4())),
                input_pack_id=input_pack_id,
                question=ex_data["question"],
                options=ex_data["options"],
                correct_answer=ex_data["correct_answer"],
                explanation=ex_data["explanation"],
                created_at=datetime.utcnow()
            )
            exercises.append(exercise)
            db.add(exercise)
        db.commit()
        return exercises
    
    def create_evaluation(self, db: Session, poa_task_id: str, attempt1_id: str, 
                         attempt2_id: str, evaluation_data: Dict[str, Any]) -> models.Evaluation:
        evaluation = models.Evaluation(
            id=str(uuid.uuid4()),
            poa_task_id=poa_task_id,
            attempt1_id=attempt1_id,
            attempt2_id=attempt2_id,
            seven_dimension_scores=evaluation_data["seven_dimension_scores"],
            gap_improvements=evaluation_data["gap_improvements"],
            overall_judgment=evaluation_data["overall_judgment"],
            created_at=datetime.utcnow()
        )
        db.add(evaluation)
        db.commit()
        db.refresh(evaluation)
        return evaluation
    
    def create_report(self, db: Session, poa_task_id: str, data: Dict[str, Any]) -> models.Report:
        report = models.Report(
            id=str(uuid.uuid4()),
            poa_task_id=poa_task_id,
            data=data,
            created_at=datetime.utcnow()
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        return report
    
    def generate_task(self, db: Session, photo_url: str) -> Dict[str, Any]:
        try:
            scene_info = ai_service.analyze_image(photo_url)
            
            scenario = self.create_scenario(db, photo_url, scene_info.get("tags", []))
            
            task_data = ai_service.generate_poa_task(scene_info)
            task = self.create_poa_task(db, scenario.id, task_data)
            
            return {
                "success": True,
                "scenario": scenario,
                "task": task,
                "scene_info": scene_info
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def diagnose_attempt(self, db: Session, attempt_id: str) -> Dict[str, Any]:
        try:
            attempt = db.query(models.Attempt).filter(models.Attempt.id == attempt_id).first()
            if not attempt:
                return {"success": False, "error": "Attempt not found"}
            
            task = db.query(models.POATask).filter(models.POATask.id == attempt.poa_task_id).first()
            if not task:
                return {"success": False, "error": "Task not found"}
            
            transcript = attempt.transcript or "\n".join(turn.get("text", "") for turn in attempt.turns)
            
            gaps_data = ai_service.diagnose_performance(transcript, {
                "your_role": task.your_role,
                "ai_role": task.ai_role,
                "goal": task.goal,
                "constraints": task.constraints,
                "evaluation_criteria": task.evaluation_criteria
            })
            
            self.create_gaps(db, attempt_id, gaps_data)
            
            return {"success": True, "gaps": gaps_data}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def generate_input(self, db: Session, attempt_id: str) -> Dict[str, Any]:
        try:
            attempt = db.query(models.Attempt).filter(models.Attempt.id == attempt_id).first()
            if not attempt:
                return {"success": False, "error": "Attempt not found"}
            
            gaps = db.query(models.Gap).filter(models.Gap.attempt_id == attempt_id).all()
            gaps_data = [
                {"type": gap.type, "evidence": gap.evidence, "consequence": gap.consequence}
                for gap in gaps
            ]
            
            input_pack_data = ai_service.generate_input_pack(gaps_data)
            input_pack = self.create_input_pack(db, attempt_id, input_pack_data)
            
            exercises_data = ai_service.generate_exercises(gaps_data)
            self.create_exercises(db, input_pack.id, exercises_data)
            
            return {
                "success": True,
                "input_pack": input_pack_data,
                "exercises": exercises_data
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def evaluate(self, db: Session, attempt1_id: str, attempt2_id: str) -> Dict[str, Any]:
        try:
            attempt1 = db.query(models.Attempt).filter(models.Attempt.id == attempt1_id).first()
            attempt2 = db.query(models.Attempt).filter(models.Attempt.id == attempt2_id).first()
            
            if not attempt1 or not attempt2:
                return {"success": False, "error": "Attempt not found"}
            
            if attempt1.poa_task_id != attempt2.poa_task_id:
                return {"success": False, "error": "Attempts must belong to the same task"}
            
            task = db.query(models.POATask).filter(models.POATask.id == attempt1.poa_task_id).first()
            gaps = db.query(models.Gap).filter(models.Gap.attempt_id == attempt1_id).all()
            
            transcript1 = attempt1.transcript or "\n".join(turn.get("text", "") for turn in attempt1.turns)
            transcript2 = attempt2.transcript or "\n".join(turn.get("text", "") for turn in attempt2.turns)
            
            gaps_data = [
                {"type": gap.type, "evidence": gap.evidence, "consequence": gap.consequence}
                for gap in gaps
            ]
            
            evaluation_data = ai_service.evaluate_performance(
                transcript1, transcript2,
                {
                    "your_role": task.your_role,
                    "ai_role": task.ai_role,
                    "goal": task.goal
                },
                gaps_data
            )
            
            self.create_evaluation(db, task.id, attempt1_id, attempt2_id, evaluation_data)
            
            return {"success": True, "evaluation": evaluation_data}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_report(self, db: Session, poa_task_id: str) -> Dict[str, Any]:
        try:
            task = db.query(models.POATask).filter(models.POATask.id == poa_task_id).first()
            if not task:
                return {"success": False, "error": "Task not found"}
            
            scenario = db.query(models.Scenario).filter(models.Scenario.id == task.scenario_id).first()
            attempts = db.query(models.Attempt).filter(models.Attempt.poa_task_id == poa_task_id).order_by(models.Attempt.attempt_number).all()
            evaluation = db.query(models.Evaluation).filter(models.Evaluation.poa_task_id == poa_task_id).first()
            
            gaps = []
            if attempts:
                gaps = db.query(models.Gap).filter(models.Gap.attempt_id == attempts[0].id).all()
            
            input_pack = None
            exercises = []
            if attempts:
                input_pack = db.query(models.InputPack).filter(models.InputPack.attempt_id == attempts[0].id).first()
                if input_pack:
                    exercises = db.query(models.Exercise).filter(models.Exercise.input_pack_id == input_pack.id).all()
            
            report_data = {
                "task": {
                    "id": task.id,
                    "your_role": task.your_role,
                    "ai_role": task.ai_role,
                    "goal": task.goal,
                    "constraints": task.constraints,
                    "evaluation_criteria": task.evaluation_criteria,
                    "created_at": task.created_at.isoformat()
                },
                "scenario": {
                    "id": scenario.id,
                    "photo_url": scenario.photo_url,
                    "tags": scenario.tags,
                    "created_at": scenario.created_at.isoformat()
                },
                "attempts": [
                    {
                        "id": a.id,
                        "attempt_number": a.attempt_number,
                        "transcript": a.transcript,
                        "turns": a.turns,
                        "created_at": a.created_at.isoformat()
                    }
                    for a in attempts
                ],
                "gaps": [
                    {
                        "type": g.type,
                        "evidence": g.evidence,
                        "consequence": g.consequence,
                        "target_improvement": g.target_improvement
                    }
                    for g in gaps
                ],
                "input_pack": input_pack.__dict__ if input_pack else None,
                "exercises": [
                    {
                        "id": e.id,
                        "question": e.question,
                        "options": e.options,
                        "correct_answer": e.correct_answer,
                        "explanation": e.explanation
                    }
                    for e in exercises
                ],
                "evaluation": evaluation.__dict__ if evaluation else None
            }
            
            return {"success": True, "report": report_data}
        except Exception as e:
            return {"success": False, "error": str(e)}

poa_service = POAService()