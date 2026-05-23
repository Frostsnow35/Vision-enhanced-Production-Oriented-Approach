from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base

class Scenario(Base):
    __tablename__ = "scenarios"
    
    id = Column(String, primary_key=True, index=True)
    photo_url = Column(String, nullable=False)
    tags = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    
    poa_task = relationship("POATask", back_populates="scenario", uselist=False)

class POATask(Base):
    __tablename__ = "poa_tasks"
    
    id = Column(String, primary_key=True, index=True)
    scenario_id = Column(String, ForeignKey("scenarios.id"))
    your_role = Column(String, nullable=False)
    ai_role = Column(String, nullable=False)
    goal = Column(Text, nullable=False)
    constraints = Column(JSON, default=[])
    evaluation_criteria = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    
    scenario = relationship("Scenario", back_populates="poa_task")
    attempts = relationship("Attempt", back_populates="poa_task")
    evaluation = relationship("Evaluation", back_populates="poa_task", uselist=False)

class Attempt(Base):
    __tablename__ = "attempts"
    
    id = Column(String, primary_key=True, index=True)
    poa_task_id = Column(String, ForeignKey("poa_tasks.id"))
    attempt_number = Column(Integer, nullable=False)
    audio_url = Column(String)
    transcript = Column(Text)
    turns = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    
    poa_task = relationship("POATask", back_populates="attempts")
    gaps = relationship("Gap", back_populates="attempt")

class Gap(Base):
    __tablename__ = "gaps"
    
    id = Column(String, primary_key=True, index=True)
    attempt_id = Column(String, ForeignKey("attempts.id"))
    type = Column(String, nullable=False)
    evidence = Column(Text)
    consequence = Column(Text)
    target_improvement = Column(Text)
    improvement_score = Column(Float)
    
    attempt = relationship("Attempt", back_populates="gaps")

class InputPack(Base):
    __tablename__ = "input_packs"
    
    id = Column(String, primary_key=True, index=True)
    attempt_id = Column(String, ForeignKey("attempts.id"))
    vocabulary = Column(JSON, default=[])
    patterns = Column(JSON, default=[])
    model_dialogue = Column(JSON, default=[])
    strategies = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)

class Exercise(Base):
    __tablename__ = "exercises"
    
    id = Column(String, primary_key=True, index=True)
    input_pack_id = Column(String, ForeignKey("input_packs.id"))
    question = Column(Text, nullable=False)
    options = Column(JSON, default=[])
    correct_answer = Column(Integer)
    explanation = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

class Evaluation(Base):
    __tablename__ = "evaluations"
    
    id = Column(String, primary_key=True, index=True)
    poa_task_id = Column(String, ForeignKey("poa_tasks.id"))
    attempt1_id = Column(String, ForeignKey("attempts.id"))
    attempt2_id = Column(String, ForeignKey("attempts.id"))
    seven_dimension_scores = Column(JSON, default=[])
    gap_improvements = Column(JSON, default=[])
    overall_judgment = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    poa_task = relationship("POATask", back_populates="evaluation")

class Report(Base):
    __tablename__ = "reports"
    
    id = Column(String, primary_key=True, index=True)
    poa_task_id = Column(String, ForeignKey("poa_tasks.id"))
    data = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)