"""
Evaluation service - Doubao LLM seven-dimension assessment and dual-track comparison.
No mock fallback: failures raise exceptions.
"""
import json
import logging
from typing import Any, Dict, List

import httpx

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID, DOUBAO_BASE_URL
from services.asr_service import NO_VOICE_MARKER

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evaluate_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

_DIMENSIONS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"]

_DIM_KEY_MAP = {
    "d1": "pronunciation",
    "d2": "grammar",
    "d3": "vocabulary",
    "d4": "task_completion",
    "d5": "pragmatics",
    "d6": "turn_taking",
    "d7": "paralinguistic",
}

_RUBRIC = """\
评分标准（1.0=最差, 5.0=最佳, 精确到0.1）:

d1 发音标准度:
  1分=系统性音素错误>=35%, 整句难懂
  2分=错误率20%-34%, 影响理解
  3分=错误率<15%, 可懂度>=70%
  4分=发音整体准确, 仅微小偏差, 可懂度>=80%
  5分=发音稳定清晰, 无系统性错误, 可懂度>=90%

d2 语法规范性:
  1分=错误率>=35%, 逻辑混乱
  2分=错误率20%-34%, 语义模糊
  3分=错误率<15%, 核心意思可懂
  4分=准确率>=80%, 复杂句偶有小偏差
  5分=准确率>=90%, 无影响理解的错误

d3 词汇适配性:
  1分=用词与场景严重脱节
  2分=频繁出现不恰当词汇
  3分=基本匹配场景, 准确率>=70%
  4分=匹配度高, 覆盖75%所需词汇
  5分=高度匹配, 覆盖80%以上, 搭配地道

d4 语言功能达成度:
  1分=任务完成率<50%
  2分=完成率50%-69%, 意图模糊
  3分=完成率>=70%, 意图可理解
  4分=完成率>=80%, 核心任务基本完成
  5分=完成率>=85%, 高效完成, 意图精准

d5 语用策略得体性:
  1分=礼貌表达率<30%, 语气生硬
  2分=率30%-49%, 仅1-2个礼貌词
  3分=率>=50%, 使用基础句式
  4分=率>=70%, 语气自然得体
  5分=率>=85%, 灵活调整礼貌策略

d6 话语回合适配性:
  1分=话轮失衡率>=50%, 无转换信号
  2分=失衡率30%-49%, 控制不佳
  3分=失衡率<30%, 长度基本合理
  4分=失衡率<20%, 互动顺畅
  5分=失衡率<10%, 灵活调整, 节奏舒适

d7 副语言匹配度:
  1分=有效眼神<30%, 表情僵化
  2分=眼神飘忽, 匹配率30%-49%
  3分=眼神接触基本同步, 占比>=50%
  4分=眼神自然稳定, 占比>=70%
  5分=眼神精准适配, 占比>=90%, 能强化表达
  注意: 若无视频流无法分析, 该项打0分, 评语注明"无视频流, 此项无法评估"

重要: 分数范围1-5分, 如果某个维度无法从对话中分析(如无音频/无视频), 该项打0分.
根据学生对话文本中的实际表现评分, 不要默认给固定分数.
文本很短或只有问候 -> 2.0-3.0范围.
有完整句子和交际意图 -> 3.0-4.0范围.
只有真正优秀的表现才给4.5+.
"""

_SINGLE_PROMPT = (
    "You are an English speaking assessor. Score the student's dialogue using this rubric:\n\n"
    + _RUBRIC + "\n\n"
    + "Rules:\n"
    + "1. Score each dimension d1-d7: 1.0-5.0, precision 0.1.\n"
    + "2. No audio: d1=0, comment 'no audio stream, unable to evaluate'.\n"
    + "3. No video: d7=0, comment 'no video stream, unable to evaluate'.\n"
    + "4. EVERY comment MUST quote the student's EXACT words as evidence.\n"
    + "5. Score 1.0-5.0 based on observed performance. Score 0 if cannot analyze.\n\n"
    + 'Output ONLY this JSON: {"scores":{"d1":3.0,"d2":2.5,"d3":3.0,"d4":3.0,"d5":2.5,"d6":3.0,"d7":0},"comments":{"d1":"evidence...",...}}'
)

_COMPARE_PROMPT = (
    "You are an English speaking assessor. Compare the student's Attempt 1 and Attempt 2 using this rubric:\n\n"
    + _RUBRIC + "\n\n"
    + "Rules:\n"
    + "1. attempt1_score and attempt2_score: 1.0-5.0, precision 0.1. change: signed float (+1.2 or -0.3).\n"
    + "2. EVERY comment MUST quote EXACT words from BOTH attempts as evidence.\n"
    + "3. example field: verbatim comparison. If text empty: 'no evidence available'.\n"
    + "4. No audio: d1=0 with note. No video: d7=0 with note.\n"
    + "5. Score 1.0-5.0 based on observed differences. Score 0 if cannot analyze.\n\n"
    + 'Output ONLY this JSON: {"comparison":[{"dimension":"d1","attempt1_score":3.0,"attempt2_score":3.0,"change":"+0.0","comment":"...","example":"..."}]}'
)

_TARGET_PROMPT = (
    "You are an English speaking assessment expert. The student's first attempt had some gaps.\n"
    "Read the second attempt and judge whether each gap has been improved.\n\n"
    "For each gap output: gap_label, improved (true/false), evidence (quote from second attempt), suggestion.\n\n"
    'Output JSON array: [{"gap_label":"...","improved":true,"evidence":"...","suggestion":"..."}]'
)


def _call_llm(messages: List[Dict[str, str]], timeout: int = 120) -> str:
    body = {"model": DOUBAO_MODEL_ID, "messages": messages}
    with httpx.Client(timeout=float(timeout)) as client:
        resp = client.post(
            DOUBAO_CHAT_URL,
            headers={
                "Authorization": f"Bearer {DOUBAO_API_KEY}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _parse_json(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines)
    return json.loads(raw)


def _scale_score(value: float) -> float:
    return round(value * 2.0, 1)


def _scale_dimensions(scores: Dict[str, float]) -> Dict[str, float]:
    return {k: _scale_score(v) for k, v in scores.items()}


def evaluate_single(
    conversation_text: str, task_context: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    logger.info(f"[evaluate_single] text length={len(conversation_text) if conversation_text else 0}")

    stripped = (conversation_text or "").strip()
    if not stripped or stripped == NO_VOICE_MARKER:
        logger.warning("[evaluate_single] empty text, not calling LLM")
        zero_scores = {eng: 0.0 for eng in _DIM_KEY_MAP.values()}
        zero_comments = {eng: "no voice detected, all scores zero" for eng in _DIM_KEY_MAP.values()}
        return {"dimension_scores": zero_scores, "comments": zero_comments}

    ctx = task_context or {}
    scene = ctx.get("scene_label", "unknown")
    roles = ctx.get("roles", "unknown")
    goal = ctx.get("goal", "unknown")

    user_content = (
        f"Scene: {scene}\nRoles: {roles}\nGoal: {goal}\n\n"
        f"Student dialogue:\n{conversation_text[:2000]}\n\n"
        f"Score using the seven-dimension rubric, output JSON."
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _SINGLE_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        if not isinstance(data, dict):
            raise ValueError(f"Expected dict, got {type(data)}")
        raw_scores = data.get("scores", {})
        raw_comments = data.get("comments", {})
        # Map d1-d7 LLM output to English keys
        scores = {}
        comments = {}
        for dk, eng in _DIM_KEY_MAP.items():
            scores[eng] = _scale_score(float(raw_scores.get(dk, 0)))
            comments[eng] = raw_comments.get(dk, "")
        logger.info(f"[evaluate_single] LLM returned {len(scores)} dimensions")
        return {"dimension_scores": scores, "comments": comments}
    except Exception as e:
        logger.error(f"[evaluate_single] LLM failed: {e}")
        raise


def evaluate_compare(
    attempt1_text: str, attempt2_text: str
) -> Dict[str, Any]:
    logger.info(f"[evaluate_compare] text1={len(attempt1_text)} chars, text2={len(attempt2_text)} chars")

    t1 = (attempt1_text or "").strip()
    t2 = (attempt2_text or "").strip()
    if (not t1 or t1 == NO_VOICE_MARKER) and (not t2 or t2 == NO_VOICE_MARKER):
        logger.warning("[evaluate_compare] both texts empty")
        zero_scores = {eng: 0.0 for eng in _DIM_KEY_MAP.values()}
        zero_comp = [
            {
                "dimension": eng, "attempt1_score": 0.0, "attempt2_score": 0.0,
                "change": "+0.0", "comment": "no voice", "example": "no evidence available",
            }
            for eng in _DIM_KEY_MAP.values()
        ]
        zero_dim = {
            eng: {"attempt1": 0.0, "attempt2": 0.0, "comment": "no voice", "example": "no evidence available"}
            for eng in _DIM_KEY_MAP.values()
        }
        return {"attempt1_scores": zero_scores, "attempt2_scores": zero_scores, "dimension_scores": zero_dim, "comparison": zero_comp}

    user_content = (
        f"[Attempt 1]\n{attempt1_text[:1500]}\n\n"
        f"[Attempt 2]\n{attempt2_text[:1500]}\n\n"
        f"Compare and score each dimension, output JSON."
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _COMPARE_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        if not isinstance(data, dict):
            raise ValueError(f"Expected dict, got {type(data)}")
        comparison = data.get("comparison", [])

        a1_scores: Dict[str, float] = {}
        a2_scores: Dict[str, float] = {}
        for item in comparison:
            dim = item.get("dimension", "")
            a1_scores[dim] = _scale_score(float(item.get("attempt1_score", 0)))
            a2_scores[dim] = _scale_score(float(item.get("attempt2_score", 0)))
            raw_change = float(item.get("change", "0").replace("+", ""))
            item["change"] = f"{'+' if raw_change >= 0 else ''}{round(raw_change * 2, 1)}"
            item["attempt1_score"] = a1_scores[dim]
            item["attempt2_score"] = a2_scores[dim]

        dim_scores: Dict[str, Dict[str, Any]] = {}
        for item in comparison:
            dim_cn = item.get("dimension", "")
            key = _DIM_KEY_MAP.get(dim_cn, dim_cn)
            dim_scores[key] = {
                "attempt1": item.get("attempt1_score", 0),
                "attempt2": item.get("attempt2_score", 0),
                "comment": item.get("comment", ""),
                "example": item.get("example", "no evidence available"),
            }

        logger.info(f"[evaluate_compare] LLM returned {len(comparison)} dimensions")
        return {"attempt1_scores": a1_scores, "attempt2_scores": a2_scores, "dimension_scores": dim_scores, "comparison": comparison}
    except Exception as e:
        logger.error(f"[evaluate_compare] LLM failed: {e}")
        raise


def evaluate_target_gaps(
    attempt1_text: str, attempt2_text: str, gaps: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    logger.info(f"[evaluate_target_gaps] gaps={len(gaps)}, text2={len(attempt2_text)} chars")

    if not gaps:
        return []
    if not attempt2_text.strip():
        return [{"gap_label": g.get("label", "unknown"), "improved": False, "evidence": "empty attempt2", "suggestion": "complete attempt2 first"} for g in gaps]

    gap_lines = []
    for i, g in enumerate(gaps, 1):
        gap_lines.append(f"Gap {i}: [{g.get('label', 'unknown')}] evidence: {g.get('evidence_sentence', '')} explanation: {g.get('explanation', '')}")
    gaps_text = "\n".join(gap_lines)

    user_content = (
        f"[Gaps found in attempt 1]\n{gaps_text}\n\n"
        f"[Attempt 1 text]\n{attempt1_text[:800]}\n\n"
        f"[Attempt 2 text]\n{attempt2_text[:1500]}\n\n"
        f"Judge each gap: improved or not? Output JSON array."
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _TARGET_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        if isinstance(data, list) and len(data) > 0:
            logger.info(f"[evaluate_target_gaps] LLM returned {len(data)} items")
            return data
        raise ValueError("unexpected response format")
    except Exception as e:
        logger.error(f"[evaluate_target_gaps] LLM failed: {e}")
        raise
