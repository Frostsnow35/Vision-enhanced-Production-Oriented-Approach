"""
ORM 模型定义 —— 英语学习闭环（POA 产出导向法）的 6 张核心表。

表关系总览：
  Scenario (1) ──→ (N) POATask (1) ──→ (N) Attempt (1) ──→ (N) Gap (1) ──→ (1) InputPack
                                                       │                              │
                                                       │                              └─ task_id (冗余外键，可选)
  Evaluation ───────────────── attempt1_id ────────────┤
              ───────────────── attempt2_id ────────────┘
"""
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship, declarative_base


def _utcnow():
    """返回当前 UTC 时间（可调用对象，用作 Column default）。"""
    return datetime.now(timezone.utc)

# SQLAlchemy 声明式基类，所有 ORM 模型都继承自它
Base = declarative_base()


# ============================================================
# 1. Scenario — 场景表
# ============================================================
class Scenario(Base):
    """
    场景表：存储一个对话/学习场景的元信息。
    一个场景下可以有多个 POA 任务。
    """
    __tablename__ = "scenarios"

    id = Column(Integer, primary_key=True, index=True)
    # 场景图片的文件路径（前端用来展示场景背景）
    image_path = Column(String(500), nullable=False)
    # 图片文件的 MD5 哈希值，用于去重缓存
    image_hash = Column(String(32), unique=True, nullable=True)
    # 场景标签，例如 "机场check-in" / "餐厅点餐"
    scene_label = Column(String(200), nullable=False)
    # 记录创建时间，默认取当前 UTC 时间
    created_at = Column(DateTime, default=_utcnow)

    # 一对多：一个 Scenario 下挂多个 POATask
    poa_tasks = relationship("POATask", back_populates="scenario")


# ============================================================
# 2. POATask — 任务表
# ============================================================
class POATask(Base):
    """
    任务表：每个场景下的一个具体产出任务。
    包含角色、目标、约束、评价标准、变体情节等 POA 核心要素。
    """
    __tablename__ = "poa_tasks"

    id = Column(Integer, primary_key=True, index=True)
    # 外键 → scenarios.id
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)
    # 角色描述，例如 "你是顾客，对方是店员"
    roles = Column(Text, nullable=True)
    # 交际目标，例如 "成功退换一件有瑕疵的商品"
    goal = Column(Text, nullable=True)
    # 场景约束，例如 "店员态度冷淡，且店里很忙"
    context_constraints = Column(Text, nullable=True)
    # 评价标准，逐条列出评分维度
    evaluation_criteria = Column(Text, nullable=True)
    # 变体情节，用于同一任务的不同难度/变体
    variant_plot = Column(Text, nullable=True)
    # AI 开场白，由 VLM 在任务生成时产出；用于 chatStart 直接使用
    opening_line = Column(Text, nullable=True)
    # AI 收尾语，由 VLM 在任务生成时产出；用于 chatTurn is_final 提前识别 + Plan A 自动收尾
    closing_line = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    # 多对一：回到 Scenario
    scenario = relationship("Scenario", back_populates="poa_tasks")
    # 一对多：一个 POATask 下有多次 Attempt
    attempts = relationship("Attempt", back_populates="task")
    # 一对多：一个 POATask 对应多个 InputPack（通过 task_id 冗余外键）
    input_packs = relationship("InputPack", back_populates="task")


# ============================================================
# 3. Attempt — 产出记录表
# ============================================================
class Attempt(Base):
    """
    产出记录表：学生针对某个任务的一次作答（口语或文本）。
    同一个 task 可以有多次 attempt（如第 1 次作答、第 2 次改进作答）。
    """
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    # 外键 → poa_tasks.id
    task_id = Column(Integer, ForeignKey("poa_tasks.id"), nullable=False)
    # 第几次尝试（1, 2, 3...）
    attempt_number = Column(Integer, nullable=False)
    # 录音文件路径（可选，文本作答时为空）
    audio_path = Column(String(500), nullable=True)
    # 作答文本（语音转写结果 或 直接输入的文本）
    text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    # 多对一：回到 POATask
    task = relationship("POATask", back_populates="attempts")
    # 一对多：一次 Attempt 可以分析出多个 Gap
    gaps = relationship("Gap", back_populates="attempt")


# ============================================================
# 4. Gap — 不足表
# ============================================================
class Gap(Base):
    """
    不足表：记录一次 Attempt 中暴露的具体问题。
    每个 Gap 对应一条 evidence_sentence（原文证据）和一段 explanation（讲解）。
    """
    __tablename__ = "gaps"

    id = Column(Integer, primary_key=True, index=True)
    # 外键 → attempts.id
    attempt_id = Column(Integer, ForeignKey("attempts.id"), nullable=False)
    # 不足的标签，例如 "语法错误" / "词汇单一" / "语用不当"
    label = Column(String(200), nullable=False)
    # 原文中体现该问题的句子
    evidence_sentence = Column(Text, nullable=True)
    # 对该问题的解释说明
    explanation = Column(Text, nullable=True)
    # 建议的参考表达（更自然/准确的英文正确说法）
    reference_expression = Column(Text, nullable=True)

    # 多对一：回到 Attempt
    attempt = relationship("Attempt", back_populates="gaps")
    # 一对一：每个 Gap 对应一个 InputPack（学习补救材料）
    input_packs = relationship("InputPack", back_populates="gap")


# ============================================================
# 5. InputPack — 学习材料包
# ============================================================
class InputPack(Base):
    """
    学习材料包：针对某个 Gap 提供的补救学习材料。
    包含场景语块、功能句、示范对话、策略提示。
    同时冗余一个 task_id 外键，方便直接从任务维度查询所有材料。
    """
    __tablename__ = "input_packs"

    id = Column(Integer, primary_key=True, index=True)
    # 外键 → gaps.id（一个 Gap 对应一个 InputPack）
    gap_id = Column(Integer, ForeignKey("gaps.id"), nullable=False)
    # 冗余外键 → poa_tasks.id（可选），便于跨表查询
    task_id = Column(Integer, ForeignKey("poa_tasks.id"), nullable=True)
    # 场景语块：从场景中提取的关键表达
    scene_chunks = Column(Text, nullable=True)
    # 功能句：实现该交际功能的核心句型
    functional_sentences = Column(Text, nullable=True)
    # 示范对话：一段包含目标表达的示例对话
    demo_dialogue = Column(Text, nullable=True)
    # 策略提示：学习策略上的建议
    strategy_tip = Column(Text, nullable=True)

    # 多对一：回到 Gap
    gap = relationship("Gap", back_populates="input_packs")
    # 多对一：回到 POATask（通过冗余外键）
    task = relationship("POATask", back_populates="input_packs")


# ============================================================
# 6. Evaluation — 评价表
# ============================================================
class Evaluation(Base):
    """
    评价表：对比两次 Attempt（改进前 vs 改进后），评估进步程度。
    包含各维度得分、问题改善情况和完整评价报告。
    """
    __tablename__ = "evaluations"

    id = Column(Integer, primary_key=True, index=True)
    # 外键 → attempts.id（第一次作答 / 改进前）
    attempt1_id = Column(Integer, ForeignKey("attempts.id"), nullable=False)
    # 外键 → attempts.id（第二次作答 / 改进后）
    attempt2_id = Column(Integer, ForeignKey("attempts.id"), nullable=False)
    # 各维度评分，JSON 格式，例如 {"fluency": 80, "accuracy": 70}
    dimension_scores = Column(JSON, nullable=True)
    # 问题改善情况描述
    problem_improved = Column(Text, nullable=True)
    # 完整评价报告（综合评价文本）
    full_report = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    # 两个外键都指向 attempts 表，需显式指定 foreign_keys 消除歧义
    attempt1 = relationship("Attempt", foreign_keys=[attempt1_id])
    attempt2 = relationship("Attempt", foreign_keys=[attempt2_id])
