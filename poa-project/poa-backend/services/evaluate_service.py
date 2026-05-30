"""
评价服务 —— 调用豆包 LLM 进行七维能力评估与双轨对比。
LLM 不可用时自动降级为 Mock 随机数据。
"""
import json
import logging
import random
from typing import Any, Dict, List

import httpx

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID, DOUBAO_BASE_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evaluate_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

# ---- 七维评价体系 ----
_DIMENSIONS = [
    "发音标准度",
    "语法规范性",
    "词汇适配性",
    "语言功能达成度",
    "语用策略得体性",
    "话语回合适配性",
    "副语言匹配度",
]

# ---- 单次评估 Prompt ----
_SINGLE_PROMPT = """\
你是一个英语口语评估专家。请严格按照以下七维评分标准，对学生的对话文本进行评分。

【七维评分标准】
1. 发音标准度（1-5）：元音、辅音、重音、语流。若仅有文本无音频，给固定分 2.5。
2. 语法规范性（1-5）：主谓一致、虚词、复杂句的正确使用。
3. 词汇适配性（1-5）：场景词汇的准确使用（如咖啡店用 latte/cappuccino 而非 big coffee），搭配是否地道。
4. 语言功能达成度（1-5）：交际任务完成度（问候→点单→确认→支付等全部环节），信息是否完整。
5. 语用策略得体性（1-5）：礼貌表达（please/thank you/委婉句式），是否符合该场景的社交规范。
6. 话语回合适配性（1-5）：话轮长度是否合适，是否使用话语标记（Well/Actually/Sure）自然转换话轮。
7. 副语言匹配度（1-5）：眼神、表情、手势、嗓音的情感表达。若无视频流，给固定分 2.5。

【输出要求】
严格输出如下 JSON（不要输出任何其他内容）：
{
  "scores": {
    "发音标准度": 2.5,
    "语法规范性": 3.0,
    "词汇适配性": 3.0,
    "语言功能达成度": 3.0,
    "语用策略得体性": 3.0,
    "话语回合适配性": 3.0,
    "副语言匹配度": 2.5
  },
  "comments": {
    "发音标准度": "无音频流，无法评估发音，给基准分。",
    "语法规范性": "对话中出现'He go to...'主谓不一致，应改为'He goes to...'，整体语法意识有待提高。",
    "词汇适配性": "使用了'small coffee'而非场景术语'americano'或'latte'，场景词汇储备不足。",
    ...
  }
}
每个 comment 必须引用对话中的具体证据（原文句子或描述），长度 30-80 字。"""

# ---- 双轨对比 Prompt ----
_COMPARE_PROMPT = """\
你是一个英语口语评估专家。请对比学生的初次产出和二次产出，对每个维度评分并写对比评语。

【七维评分标准（同单次评估）】
1. 发音标准度（1-5）：元音、辅音、重音、语流。无音频给 2.5。
2. 语法规范性（1-5）：主谓一致、虚词、复杂句。
3. 词汇适配性（1-5）：场景词汇、搭配。
4. 语言功能达成度（1-5）：任务完成度、信息完整度。
5. 语用策略得体性（1-5）：礼貌表达、场景适配。
6. 话语回合适配性（1-5）：话轮长度、转换策略。
7. 副语言匹配度（1-5）：眼神、表情、手势、嗓音。无视频给 2.5。

【对比评语要求】
每个维度的 comment 必须包含:
1. 引用初次产出中的具体例子（原文）。
2. 引用二次产出中的具体例子（原文），说明进步或退步在哪里。
3. 解释分数变化的具体原因。

【输出要求】
严格输出如下 JSON（不要输出任何其他内容）：
{
  "comparison": [
    {
      "dimension": "发音标准度",
      "attempt1_score": 2.5,
      "attempt2_score": 2.5,
      "change": "+0.0",
      "comment": "两次均为文本输入，无音频流，副语言维度暂无法评估。"
    },
    ...
  ]
}"""

# ---- Mock 降级 ----
_MOCK_COMMENTS: Dict[str, List[str]] = {
    "发音标准度": [
        "从单词发音不准到元音和辅音更清晰，连读意识初步建立。",
        "重音和语调模式有所改善，个别音素仍需强化。",
    ],
    "语法规范性": [
        "从多处主谓一致错误改进为基本正确，时态使用更规范。",
        "句子结构从碎片化趋向完整，时态混用现象明显减少。",
    ],
    "词汇适配性": [
        "从笼统词汇转变为场景专有词汇，搭配更自然地道。",
        "同义替换能力提升，避免了反复使用基础词汇。",
    ],
    "语言功能达成度": [
        "从只能表达个别请求进展到完成完整交际任务。",
        "信息传递更完整准确，关键交际功能点均已覆盖。",
    ],
    "语用策略得体性": [
        "从祈使句转变为委婉请求，礼貌意识显著提升。",
        "'please'和'thank you'使用频率增加，社交礼仪更自然。",
    ],
    "话语回合适配性": [
        "从简单回应进展到能有效进行话轮交替，互动感增强。",
        "能使用话语标记自然过渡，回应更及时。",
    ],
    "副语言匹配度": [
        "语音节奏更自然，停顿位置更合理。",
        "语速控制改善，能根据内容调整快慢。",
    ],
}


# ============================================================
# 通用 LLM 调用
# ============================================================
def _call_llm(messages: List[Dict[str, str]], timeout: int = 60) -> str:
    """调用豆包 LLM，返回原始文本；失败抛出异常。"""
    import time
    t0 = time.time()
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
    elapsed = time.time() - t0
    logger.info(f"[LLM] model={DOUBAO_MODEL_ID} status={resp.status_code} duration={elapsed:.2f}s")
    return resp.json()["choices"][0]["message"]["content"]


def _parse_json(raw: str) -> Dict[str, Any]:
    """解析 LLM 返回的 JSON，自动处理 markdown 代码块包裹。"""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines)
    return json.loads(raw)


# ============================================================
# 1. 单次能力评估
# ============================================================
def evaluate_single(
    conversation_text: str, task_context: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    """
    调用 LLM 对单次对话进行七维评分（1-5，一位小数）。
    task_context 可选：{ scene_label, roles, goal }。
    失败自动降级 Mock。
    """
    logger.info(f"[evaluate_single] text length={len(conversation_text) if conversation_text else 0}")

    if not conversation_text.strip():
        logger.warning("[evaluate_single] 空文本，返回空 scores")
        return {"dimension_scores": {}, "comments": {}}

    # ---- 构建 prompt ----
    ctx = task_context or {}
    scene = ctx.get("scene_label", "未知场景")
    roles = ctx.get("roles", "未知角色")
    goal = ctx.get("goal", "未知目标")

    user_content = (
        f"场景: {scene}\n角色: {roles}\n目标: {goal}\n\n"
        f"学生对话文本:\n{conversation_text[:2000]}\n\n"
        f"请按七维标准评分，输出 JSON。"
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _SINGLE_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        scores = data.get("scores", {})
        comments = data.get("comments", {})
        logger.info(f"[evaluate_single] LLM 返回 {len(scores)} 个维度")
        return {"dimension_scores": scores, "comments": comments}
    except Exception as e:
        logger.warning(f"[evaluate_single] LLM 调用失败: {e}，降级 Mock")

    # ---- 降级: Mock 随机分数 ----
    fallback_scores: Dict[str, float] = {}
    base = 2.5 + (0.5 if len(conversation_text) > 200 else 0)
    for dim in _DIMENSIONS:
        score = round(base + random.uniform(-0.8, 1.0), 1)
        fallback_scores[dim] = max(1.0, min(5.0, score))

    return {"dimension_scores": fallback_scores, "comments": {}}


# ============================================================
# 2. 双轨对比评估
# ============================================================
def evaluate_compare(
    attempt1_text: str, attempt2_text: str
) -> Dict[str, Any]:
    """
    调用 LLM 对比两次产出，返回双轨分数 + 各维度变化 + 对比评语。
    失败自动降级 Mock。
    """
    logger.info(
        f"[evaluate_compare] text1={len(attempt1_text)} chars, "
        f"text2={len(attempt2_text)} chars"
    )

    if not attempt1_text.strip() and not attempt2_text.strip():
        logger.warning("[evaluate_compare] 空文本")
        return {"attempt1_scores": {}, "attempt2_scores": {}, "comparison": []}

    # ---- 调用 LLM ----
    user_content = (
        f"【初次产出】\n{attempt1_text[:1500]}\n\n"
        f"【二次产出】\n{attempt2_text[:1500]}\n\n"
        f"请对比两次产出，按七维标准逐一打分并写对比评语，输出 JSON。"
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _COMPARE_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        comparison = data.get("comparison", [])

        a1_scores: Dict[str, float] = {}
        a2_scores: Dict[str, float] = {}
        for item in comparison:
            dim = item.get("dimension", "")
            a1_scores[dim] = float(item.get("attempt1_score", 0))
            a2_scores[dim] = float(item.get("attempt2_score", 0))

        logger.info(f"[evaluate_compare] LLM 返回 {len(comparison)} 个维度")
        return {
            "attempt1_scores": a1_scores,
            "attempt2_scores": a2_scores,
            "comparison": comparison,
        }
    except Exception as e:
        logger.warning(f"[evaluate_compare] LLM 调用失败: {e}，降级 Mock")

    # ---- 降级: Mock 随机对比数据 ----
    a1_scores = {}
    a2_scores = {}
    comparison = []

    for dim in _DIMENSIONS:
        base_a1 = round(2.0 + random.uniform(0, 1.5), 1)
        improvement = round(0.5 + random.uniform(0, 1.0), 1)
        a1_scores[dim] = max(1.0, min(5.0, base_a1))
        a2_scores[dim] = max(1.0, min(5.0, base_a1 + improvement))

        change_val = round(a2_scores[dim] - a1_scores[dim], 1)
        sign = "+" if change_val >= 0 else ""
        comment = random.choice(_MOCK_COMMENTS.get(dim, ["表现有所提升。"]))

        comparison.append({
            "dimension": dim,
            "attempt1_score": a1_scores[dim],
            "attempt2_score": a2_scores[dim],
            "change": f"{sign}{change_val}",
            "comment": comment,
        })

    return {
        "attempt1_scores": a1_scores,
        "attempt2_scores": a2_scores,
        "comparison": comparison,
    }


# ---- 靶向评估 Prompt ----
_TARGET_PROMPT = """\
你是一个英语口语评估专家。学生的初次产出被诊断出若干语言不足（gaps）。
现在请阅读学生的二次产出文本，逐一判断每个 gap 是否得到改善。

【判断标准】
1. 如果二次产出中该问题已不再出现，或者使用了更正确的表达 → improved: true
2. 如果该问题仍然存在 → improved: false
3. evidence 字段必须引用二次产出中的具体原文，说明改善或未改善的证据
4. suggestion 字段给出下一步建议（如已改善，建议如何巩固；如未改善，建议如何针对性练习）

【输出要求】
严格输出如下 JSON 数组（不要输出任何其他内容）：
[
  {
    "gap_label": "gap 的标签名",
    "improved": true,
    "evidence": "从二次产出中引用的具体原文句子作为证据",
    "suggestion": "下一步练习建议（1-2句话）"
  }
]"""


# ============================================================
# 3. 靶向评估 —— 逐个 gap 判断是否改善
# ============================================================
def evaluate_target_gaps(
    attempt1_text: str,
    attempt2_text: str,
    gaps: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    根据初次产出的诊断 gaps，逐条判断二次产出中是否得到改善。
    LLM 不可用时降级为随机 Mock 判断。
    """
    logger.info(
        f"[evaluate_target_gaps] gaps={len(gaps)}, "
        f"text2={len(attempt2_text)} chars"
    )

    if not gaps:
        logger.warning("[evaluate_target_gaps] gaps 列表为空")
        return []
    if not attempt2_text.strip():
        logger.warning("[evaluate_target_gaps] 二次产出文本为空，全部标记为未改善")
        return [
            {
                "gap_label": g.get("label", "未知不足"),
                "improved": False,
                "evidence": "二次产出文本为空",
                "suggestion": "请完成二次产出后再进行评估",
            }
            for g in gaps
        ]

    # ---- 构建 prompt ----
    gap_lines = []
    for i, g in enumerate(gaps, 1):
        label = g.get("label", "未知")
        ev = g.get("evidence_sentence", "")
        expl = g.get("explanation", "")
        gap_lines.append(
            f"Gap {i}: [{label}]\n  原文证据: {ev}\n  问题说明: {expl}"
        )
    gaps_text = "\n".join(gap_lines)

    user_content = (
        f"【初次产出中发现的不足】\n{gaps_text}\n\n"
        f"【初次产出原文】\n{attempt1_text[:800]}\n\n"
        f"【二次产出原文】\n{attempt2_text[:1500]}\n\n"
        f"请逐一判断每个 gap 是否改善，输出 JSON 数组。"
    )

    # ---- 调用 LLM ----
    try:
        raw = _call_llm([
            {"role": "system", "content": _TARGET_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        if isinstance(data, list) and len(data) > 0:
            logger.info(f"[evaluate_target_gaps] LLM 返回 {len(data)} 条")
            return data
        else:
            raise ValueError("返回格式不是列表")
    except Exception as e:
        logger.warning(f"[evaluate_target_gaps] LLM 调用失败: {e}，降级 Mock")

    # ---- 降级: Mock 判断 ----
    mock_results = []
    for g in gaps:
        label = g.get("label", "未知不足")
        ev = g.get("evidence_sentence", "")
        improved = random.choice([True, True, False])  # 2/3 概率改善
        mock_results.append({
            "gap_label": label,
            "improved": improved,
            "evidence": (
                f"二次产出中{'已修正' if improved else '仍需注意'}此问题。"
                f"（Mock 降级，实际评估需 LLM）"
            ),
            "suggestion": (
                "已取得进步，建议在更多场景中巩固此表达。"
                if improved
                else "建议针对此项进行专项练习，参考促成学习中的范例。"
            ),
        })

    return mock_results
