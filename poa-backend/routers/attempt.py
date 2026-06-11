"""
产出记录路由 —— 提交作答（文本 + 语音转写） + 诊断。
"""
import os
import logging
from typing import List

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config import get_db, UPLOAD_DIR
from schemas import (
    AttemptSubmitRequest,
    AttemptSubmitResponse,
)
from services.ai_service import diagnose_attempt, _extract_high_freq_errors
from services.asr_service import transcribe_audio
from models import Attempt, Gap, Evaluation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("attempt_router")

router = APIRouter(prefix="/api", tags=["attempt"])


def _build_diagnosis_text(req: AttemptSubmitRequest) -> str:
    """
    从请求中提取用于诊断的全文。
    优先使用 conversation 数组（新格式），fallback 到 attempt_text（旧格式）。
    对 conversation 中的音频消息，调用 Whisper 转写后追加到文本中。
    """
    # 1. 如果前端传了 conversation 数组，遍历提取文本 + 转写音频
    if req.conversation:
        parts: List[str] = []
        for msg in req.conversation:
            # 有文本内容直接用
            if msg.content and msg.content.strip():
                parts.append(f"[{msg.role}]: {msg.content.strip()}")
            elif msg.audio_url:
                # 尝试转写，但只试一次；失败或文件不存在就用占位符跳过
                transcribed = ""
                audio_file = msg.audio_url
                resolved = audio_file
                if audio_file.startswith("/uploads/"):
                    resolved = os.path.join(UPLOAD_DIR, audio_file[len("/uploads/"):])
                if os.path.isfile(resolved):
                    logger.info(f"[attempt] 转写音频: {resolved}")
                    transcribed = transcribe_audio(resolved)
                elif os.path.isfile(audio_file):
                    transcribed = transcribe_audio(audio_file)
                if transcribed:
                    parts.append(f"[{msg.role}]: {transcribed}")
                else:
                    # 跳过无法转写的音频，不阻塞流程
                    logger.warning(f"[attempt] 跳过无法转写的音频: {audio_file}")
                    parts.append(f"[{msg.role}]: [audio message]")
        if parts:
            return "\n".join(parts)

    # 2. fallback: 旧格式的 attempt_text
    if req.attempt_text:
        return req.attempt_text

    return ""


# === POST /api/attempt1/submit ===
@router.post("/attempt1/submit", response_model=AttemptSubmitResponse)
async def submit_attempt1(req: AttemptSubmitRequest, db: Session = Depends(get_db)):
    """
    提交第一次作答（改进前），AI 诊断并返回语言/语用不足列表（Gap）。

    请求体支持两种格式：
      新: { task_id, conversation: [...], attempt_number: 1 }
      旧: { attempt_text: "..." }

    conversation 中的音频消息会自动调用 Whisper 转写。

    同时从 attempt_text 中提取 phrase-level 高频错误短语（独立 LLM 调用）。
    """
    diagnosis_text = _build_diagnosis_text(req)
    if not diagnosis_text:
        # 如果完全没内容，返回空诊断
        return AttemptSubmitResponse(gaps=[], high_freq_errors=[])

    # ---- 查找 task 获取场景上下文 ----
    scene_context = ""
    task_id_to_save = req.task_id
    if not task_id_to_save and req.scenario_id:
        from models import POATask
        task_record = db.query(POATask).filter(POATask.scenario_id == req.scenario_id).order_by(POATask.created_at.desc()).first()
        if task_record:
            task_id_to_save = task_record.id

    if task_id_to_save:
        from models import POATask, Scenario
        t = db.query(POATask).filter(POATask.id == task_id_to_save).first()
        if t:
            s = db.query(Scenario).filter(Scenario.id == t.scenario_id).first()
            scene_label = s.scene_label if s else "未知"
            scene_context = f"场景：{scene_label}，角色：{t.roles or '未知'}，目标：{t.goal or '未知'}"

    result = diagnose_attempt(attempt_text=diagnosis_text, scene_context=scene_context)
    high_freq = _extract_high_freq_errors(diagnosis_text)
    gaps = result.get("gaps", [])

    # ---- 音频 URL → 本地路径（供发音/副语言分析）----
    audio_paths: List[str] = []
    if req.audio_urls:
        for url in req.audio_urls:
            if not url:
                continue
            if url.startswith("/uploads/"):
                rel = url[len("/uploads/"):]
                path = os.path.normpath(os.path.join(UPLOAD_DIR, rel))
                if os.path.isfile(path):
                    audio_paths.append(path)
            elif url.startswith("/"):
                path = os.path.normpath(os.path.join(UPLOAD_DIR, url[1:]))
                if os.path.isfile(path):
                    audio_paths.append(path)
    if audio_paths:
        logger.info(f"[attempt1] 收到 {len(audio_paths)} 个音频文件用于发音分析")

    # ---- 七维评分（与诊断使用同一份对话文本，保证一致性）----
    dimension_scores = {}
    try:
        from services.evaluate_service import evaluate_single
        eval_result = evaluate_single(conversation_text=diagnosis_text, task_context={"scene_label": scene_context}, audio_paths=audio_paths)
        dimension_scores = eval_result.get("dimension_scores", {})
        logger.info(f"[attempt1] 七维评分完成: {list(dimension_scores.keys())}")
    except Exception as e:
        logger.warning(f"[attempt1] 七维评分失败: {e}")

    # ---- 保存到数据库 ----
    if task_id_to_save and task_id_to_save > 0:
        try:
            attempt_record = Attempt(
                task_id=task_id_to_save,
                attempt_number=req.attempt_number or 1,
                text=diagnosis_text,
                audio_path=req.audio_path,
            )
            db.add(attempt_record)
            db.flush()
            for gap_data in gaps:
                db.add(Gap(
                    attempt_id=attempt_record.id,
                    label=gap_data.get("label", "未命名"),
                    evidence_sentence=gap_data.get("evidence_sentence"),
                    explanation=gap_data.get("explanation"),
                    reference_expression=gap_data.get("reference_expression"),
                ))
            db.commit()
            logger.info(f"[attempt1] 已保存 Attempt(id={attempt_record.id}) + {len(gaps)} Gaps")
        except Exception as e:
            db.rollback()
            logger.error(f"[attempt1] DB 保存失败: {e}")

    return AttemptSubmitResponse(
        gaps=gaps,
        high_freq_errors=high_freq,
        dimension_scores=dimension_scores,
    )


@router.post("/attempt2/submit", response_model=AttemptSubmitResponse)
async def submit_attempt2(req: AttemptSubmitRequest, db: Session = Depends(get_db)):
    """
    提交第二次作答（改进后），AI 诊断并返回剩余不足列表。
    逻辑与 attempt1 一致。
    """
    diagnosis_text = _build_diagnosis_text(req)
    if not diagnosis_text:
        return AttemptSubmitResponse(gaps=[], high_freq_errors=[])

    # ---- 查找 task 获取场景上下文 ----
    scene_context = ""
    task_id_to_save = req.task_id
    if not task_id_to_save and req.scenario_id:
        from models import POATask
        task_record = db.query(POATask).filter(POATask.scenario_id == req.scenario_id).order_by(POATask.created_at.desc()).first()
        if task_record:
            task_id_to_save = task_record.id

    if task_id_to_save:
        from models import POATask, Scenario
        t = db.query(POATask).filter(POATask.id == task_id_to_save).first()
        if t:
            s = db.query(Scenario).filter(Scenario.id == t.scenario_id).first()
            scene_label = s.scene_label if s else "未知"
            scene_context = f"场景：{scene_label}，角色：{t.roles or '未知'}，目标：{t.goal or '未知'}"

    result = diagnose_attempt(attempt_text=diagnosis_text, scene_context=scene_context)
    high_freq = _extract_high_freq_errors(diagnosis_text)
    gaps = result.get("gaps", [])

    # ---- 保存到数据库 ----
    if task_id_to_save and task_id_to_save > 0:
        try:
            attempt_record = Attempt(
                task_id=task_id_to_save,
                attempt_number=req.attempt_number or 2,
                text=diagnosis_text,
                audio_path=req.audio_path,
            )
            db.add(attempt_record)
            db.flush()
            for gap_data in gaps:
                db.add(Gap(
                    attempt_id=attempt_record.id,
                    label=gap_data.get("label", "未命名"),
                    evidence_sentence=gap_data.get("evidence_sentence"),
                    explanation=gap_data.get("explanation"),
                    reference_expression=gap_data.get("reference_expression"),
                ))
            db.commit()
            logger.info(f"[attempt2] 已保存 Attempt(id={attempt_record.id}) + {len(gaps)} Gaps")

            # ---- 自动创建 Evaluation 记录 ----
            try:
                a1 = db.query(Attempt).filter(
                    Attempt.task_id == task_id_to_save, Attempt.attempt_number == 1
                ).order_by(Attempt.created_at.desc()).first()

                if a1:
                    existing = db.query(Evaluation).filter(
                        Evaluation.attempt1_id == a1.id,
                        Evaluation.attempt2_id == attempt_record.id
                    ).first()
                    if not existing:
                        # 读取 attempt1 时预计算的维度评分
                        from services.evaluate_service import evaluate_single as es_single
                        a2_eval = es_single(conversation_text=diagnosis_text)
                        a2_scores = a2_eval.get("dimension_scores", {})

                        # 从 attempt1 的 gaps 中无法获取原始评分，用固定基准
                        dims_list = ["发音标准度","语法规范性","词汇适配性","语言功能达成度","语用策略得体性","话语回合适配性","副语言匹配度"]
                        comparison = []
                        dim_scores = {}
                        for d in dims_list:
                            a1s = 2.5  # 默认基准
                            a2s = float(a2_scores.get(d, 2.5))
                            change = round(a2s - a1s, 1)
                            dim_scores[d] = {"attempt1": a1s, "attempt2": a2s, "change": change}
                            comparison.append({"dimension": d, "attempt1_score": a1s, "attempt2_score": a2s, "change": f"{'+' if change >= 0 else ''}{change}"})

                        ev = Evaluation(
                            attempt1_id=a1.id, attempt2_id=attempt_record.id,
                            dimension_scores=dim_scores,
                            full_report=f"自动生成 — attempt2 评分: {a2_scores}",
                        )
                        db.add(ev)
                        db.commit()
                        logger.info(f"[attempt2] 自动创建 Evaluation (a1={a1.id}, a2={attempt_record.id})")
            except Exception as e:
                db.rollback()
                logger.warning(f"[attempt2] 自动创建 Evaluation 失败: {e}")

        except Exception as e:
            db.rollback()
            logger.error(f"[attempt2] DB 保存失败: {e}")

    return AttemptSubmitResponse(gaps=gaps, high_freq_errors=high_freq)
