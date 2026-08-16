"""
评价服务 —— 调用豆包 LLM 进行五维能力评估与双轨对比。
支持音频分析：传入 audio_paths 时，发音（语言能力）+ 流利度（话语能力）由本地音频分析给出真实分数。
"""
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID, DOUBAO_BASE_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evaluate_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

# ---- 五维评价体系（Celce-Murcia 交际能力模型） ----
_DIMENSIONS = [
    "语言能力",
    "话语能力",
    "行动能力",
    "社会文化能力",
    "策略能力",
]

# 各维度权重
_DIMENSION_WEIGHTS: Dict[str, float] = {
    "语言能力": 0.30,
    "话语能力": 0.175,
    "行动能力": 0.175,
    "社会文化能力": 0.175,
    "策略能力": 0.175,
}

# ---- 单次评估 Prompt ----
_SINGLE_PROMPT = """\
你是一个严格、挑剔的英语口语评估专家。请严格按照以下【五维交际能力评估表】的评分标准，对学生的对话文本进行评分。

【评分纪律 — 必须遵守】
- 默认基准分是 2.5 分，只有表现明显优于基准时才给更高分
- 4 分及以上必须要求该维度几乎无缺陷
- 不要因为对话"完成了任务"就自动给高分——要仔细检查语法、用词、策略的每个细节
- 如果学生的句子短、词汇单一、缺少礼貌用语，分数应该偏低（2.0-3.0）
- 评语中必须引用原文的具体错误，不能泛泛而谈

【任务专属评价标准】
{evaluation_criteria_block}
以上是该交际任务的场景化评价标准。请将这些标准融入对应维度的评分中，确保评价与任务目标紧密关联。

【五维评分标准】
1. 语言能力（权重 30%）
   综合评估发音、语法、词汇三个子维度：
   1.1 发音标准度
       - 若系统已给出 audio_pron（由音频分析自动计算），则发音部分直接采用该分数，comment 中注明"由音频分析自动评分"。
       - 若无 audio_pron，也请基于文本特征合理推断发音表现，comment 自然描述（不要提"无音频"或"由文本推断"）。
   1.2 语法规范性（主谓一致、时态、语态、冠词、介词、代词、从句、被动等）
       1分：错误率≥35%；2分：20-34%；3分：<15%，准确率≥70%；4分：准确率≥80%；5分：准确率≥90%
   1.3 词汇适配性（场景匹配度、词语搭配准确率）
       1分：用词严重脱节；2分：部分脱节，频繁不当；3分：基本匹配；4分：匹配度75%以上；5分：高度匹配，用词地道

2. 话语能力（权重 17.5%）
   综合评估话语连贯性、话轮转换与流利度：
   2.1 流利度与节奏
       - 若系统已给出 audio_flu（基于 WPM 和停顿频率计算），则流利度部分直接采用该分数，comment 中注明"由音频分析自动评分（基于流利度指标）"。
       - 若无 audio_flu，也请基于文本特征合理推断流利度和节奏感，comment 自然描述。
   2.2 话语连贯性与回合适配（话轮长度合理性、话题延续与转换、衔接手段）
       1分：回应困难，难以维持对话；2分：能回应但不够自然；3分：能自然回应；4分：回应积极，衔接自然；5分：回应灵活，对话流畅高效

3. 行动能力（权重 17.5%）
   综合评估语言功能与交际任务的达成度：
   3.1 主要交际任务完成度
       1分：完成率<50%；2分：50-69%；3分：≥70%，核心无遗漏；4分：≥80%；5分：≥85%，精准高效
   3.2 信息完整性
       1分：完整度<50%；2分：50-69%；3分：≥70%逻辑通顺；4分：≥80%逻辑清晰；5分：≥85%且补充有效细节

4. 社会文化能力（权重 17.5%）
   综合评估语言使用的得体性与文化适应性：
   4.1 礼貌表达使用率
       1分：<30%；2分：30-49%；3分：≥50%（含 I think/Could you… 等）；4分：≥70%；5分：≥85%
   4.2 场景与对象适配（是否符合场合、对象、文化习惯）
       1分：适配率<50%；2分：50-69%；3分：≥70%；4分：≥80%；5分：≥85%，精准匹配

5. 策略能力（权重 17.5%）
   综合评估沟通策略的运用（应对表达障碍、请求澄清、自我修正、话语标记等）：
   5.1 应对表达障碍（请求澄清、自我修正、换说法）
   5.2 话语标记与互动策略（承接、确认、缓和语气）
       1分：缺乏策略，遇阻即中断；2分：策略单一；3分：能基本运用澄清/修正；4分：能灵活运用多种策略；5分：策略运用娴熟，沟通顺畅

【输出要求】
严格输出如下 JSON（不要输出任何其他内容）：
{
  "scores": {
    "语言能力": 3.0,
    "话语能力": 3.0,
    "行动能力": 3.0,
    "社会文化能力": 3.0,
    "策略能力": 3.0
  },
  "comments": {
    "语言能力": "...",
    ...
  }
}
每个 comment 必须引用对话中的具体证据（原文句子或描述），长度 30-80 字。"""

# ---- 双轨对比 Prompt ----
_COMPARE_PROMPT = """\
你是一个严格、挑剔的英语口语评估专家。请严格按照【五维交际能力评估表】的评分标准，对比学生的初次产出和二次产出，对每个维度评分并写对比评语。

【评分纪律】
- 默认基准分 2.5 分，只对明显优秀的维度给 4+
- 仔细对比两次对话，引用原文中的具体证据说明分数变化
- 如果二次产出只是简单重复初次内容，分数不应明显提高

【任务专属评价标准】
{evaluation_criteria_block}
以上是该交际任务的场景化评价标准。请将这些标准融入对应维度的评分中，确保评价与任务目标紧密关联。

【五维度及权重】
1. 语言能力（30%）：发音、语法、词汇
2. 话语能力（17.5%）：话语连贯性、话轮转换、流利度
3. 行动能力（17.5%）：语言功能、交际任务完成度、信息完整性
4. 社会文化能力（17.5%）：礼貌表达、场景适配、文化适应性
5. 策略能力（17.5%）：沟通策略、请求澄清、自我修正

【评分约束】
- 若系统已给出 audio_pron，语言能力中的发音部分直接采用该分数（由音频分析计算），comment 注明"由音频分析自动评分"。
- 若系统已给出 audio_flu，话语能力中的流利度部分直接采用该分数，comment 注明"由音频分析自动评分（基于流利度指标）"。
- 若无 audio_pron / audio_flu，也请基于文本特征合理推断，comment 必须引用原文证据说明变化，不要提及"无音频"或"由文本推断"。

【对比评语要求】
每个维度的 comment 必须包含三个要素：
1. 引用初次产出中的具体例子（原文句子或描述）
2. 引用二次产出中的具体例子（原文句子或描述），说明进步或退步
3. 解释分数变化的具体原因

【输出要求】
严格输出如下 JSON（不要输出任何其他内容）：
{
  "comparison": [
    {
      "dimension": "语言能力",
      "attempt1_score": 2.5,
      "attempt2_score": 4.0,
      "change": "+1.5",
      "weight": 0.30,
      "comment": "初次：...；二次：...；综合提升。"
    },
    ...（共 5 个维度）
  ]
}"""

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
    import re
    text = resp.json()["choices"][0]["message"]["content"]
    return re.sub(r'</?think[^>]*>', '', text).strip()


def _parse_json(raw: str) -> Dict[str, Any]:
    """解析 LLM 返回的 JSON，自动处理 markdown 代码块、前缀文本、尾部逗号。"""
    import re
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines)

    # 处理 LLM 在 JSON 前加解释文字的情况
    raw = raw.strip()
    if not raw.startswith("{") and not raw.startswith("["):
        brace_idx = raw.find("{")
        bracket_idx = raw.find("[")
        if brace_idx != -1 or bracket_idx != -1:
            start = min(i for i in (brace_idx, bracket_idx) if i != -1)
            raw = raw[start:]

    # 提取第一个完整 JSON 对象
    if raw.startswith("{"):
        depth, end = 0, 0
        for i, ch in enumerate(raw):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0: end = i + 1; break
        if end: raw = raw[:end]

    # 移除尾部逗号
    raw = re.sub(r',\s*([}\]])', r'\1', raw)

    return json.loads(raw)


def _run_audio_analysis(audio_paths: List[str], transcribed_text: str = "") -> Optional[Dict[str, Any]]:
    """运行音频分析，失败返回 None"""
    if not audio_paths:
        return None
    try:
        from services.audio_analysis_service import analyze_audio
        return analyze_audio(audio_paths, transcribed_text)
    except Exception as e:
        logger.warning(f"[evaluate] 音频分析失败: {e}")
        return None


def _build_eval_criteria_block(evaluation_criteria: str) -> str:
    """将 evaluation_criteria 字符串格式化为 Prompt 块。"""
    if not evaluation_criteria or not evaluation_criteria.strip():
        return "（无额外场景化评价标准，请按通用五维标准评分）"

    lines = evaluation_criteria.strip().split("\n")
    items = [l.strip().lstrip("0123456789.、- ").strip() for l in lines if l.strip()]
    if not items:
        return "（无额外场景化评价标准，请按通用五维标准评分）"

    block = "该交际任务的具体评价标准如下：\n"
    for i, item in enumerate(items, 1):
        block += f"  {i}. {item}\n"
    return block


def _build_task_context_str(task_context: Dict[str, Any] | None) -> str:
    """从 task_context dict 构建上下文字符串。"""
    if not task_context:
        return "场景: 未知\n角色: 未知\n目标: 未知"
    parts = []
    if task_context.get("scene_label"):
        parts.append(f"场景: {task_context['scene_label']}")
    if task_context.get("roles"):
        parts.append(f"角色: {task_context['roles']}")
    if task_context.get("goal"):
        parts.append(f"目标: {task_context['goal']}")
    return "\n".join(parts) if parts else "场景: 未知\n角色: 未知\n目标: 未知"


def _truncate_text(text: str, max_chars: int = 4000) -> str:
    """按轮次边界截断文本，优先保留完整句子。"""
    if len(text) <= max_chars:
        return text
    # 在 max_chars 附近找最后一个换行符
    truncated = text[:max_chars]
    last_nl = truncated.rfind("\n")
    if last_nl > max_chars * 0.6:
        return truncated[:last_nl]
    # fallback: 在最后一个完整句子边界截断
    for sep in ["\n\n", ". ", "? ", "! "]:
        last = truncated.rfind(sep)
        if last > max_chars * 0.6:
            return truncated[:last + len(sep.rstrip())]
    return truncated


# ============================================================
# 1. 单次能力评估
# ============================================================
def evaluate_single(
    conversation_text: str,
    task_context: Dict[str, Any] | None = None,
    audio_paths: List[str] | None = None,
    evaluation_criteria: str = "",
) -> Dict[str, Any]:
    """
    调用 LLM 对单次对话进行五维评分（1-5，一位小数）。
    
    @param conversation_text  对话文本
    @param task_context  可选：{ scene_label, roles, goal }
    @param audio_paths  可选：音频文件路径列表，传入时发音（语言能力）+流利度（话语能力）由本地分析给出真实分数
    @param evaluation_criteria  可选：任务的场景化评价标准
    @return { dimension_scores, comments, audio_analysis }
    失败时抛出异常（无 Mock 降级）。
    """
    logger.info(f"[evaluate_single] text length={len(conversation_text) if conversation_text else 0}")

    if not conversation_text.strip():
        raise ValueError("对话文本为空，无法评估")

    # ---- 音频分析 ----
    audio_result = _run_audio_analysis(audio_paths or [], conversation_text)
    audio_info = ""
    if audio_result:
        audio_info = (
            f"\n\n【音频分析结果（已由系统自动计算，请直接使用以下分数）】\n"
            f"audio_pron(语言能力·发音) = {audio_result['pronunciation_score']}\n"
            f"audio_flu(话语能力·流利度) = {audio_result['fluency_score']}\n"
            f"流利度指标: WPM={audio_result['raw_metrics']['wpm']}, "
            f"总词数={audio_result['raw_metrics']['total_words']}, "
            f"总时长={audio_result['raw_metrics']['total_duration_seconds']}秒\n"
            f"请将上述语言能力·发音和话语能力·流利度分数直接填入 JSON，不要修改。"
        )

    # ---- 构建 prompt ----
    ctx_str = _build_task_context_str(task_context)
    eval_block = _build_eval_criteria_block(evaluation_criteria)
    system_prompt = _SINGLE_PROMPT.replace("{evaluation_criteria_block}", eval_block)

    user_content = (
        f"{ctx_str}\n\n"
        f"学生对话文本:\n{_truncate_text(conversation_text, 4000)}"
        f"{audio_info}\n\n"
        f"请按五维标准评分，输出 JSON。"
    )

    raw = _call_llm([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ])
    data = _parse_json(raw)
    scores = data.get("scores", {})
    comments = data.get("comments", {})
    logger.info(f"[evaluate_single] LLM 返回 {len(scores)} 个维度")
    result = {"dimension_scores": scores, "comments": comments}
    # 翻译 comments（中文评语 → 英文）
    try:
        from services.ai_service import _translate_texts
        comments_translations = _translate_texts(comments)
        result["comments_en"] = comments_translations
    except Exception as e:
        logger.warning(f"[evaluate_single] 翻译失败（不影响流程）: {e}")
    if audio_result:
        result["audio_analysis"] = audio_result["raw_metrics"]
    return result


# ============================================================
# 2. 双轨对比评估
# ============================================================
def evaluate_compare(
    attempt1_text: str,
    attempt2_text: str,
    audio1_paths: List[str] | None = None,
    audio2_paths: List[str] | None = None,
    evaluation_criteria: str = "",
) -> Dict[str, Any]:
    """
    调用 LLM 对比两次产出，返回双轨分数 + 各维度变化 + 对比评语。
    
    @param attempt1_text  初次产出文本
    @param attempt2_text  二次产出文本
    @param audio1_paths  初次产出音频路径列表
    @param audio2_paths  二次产出音频路径列表
    @param evaluation_criteria  任务的场景化评价标准
    失败时抛出异常（无 Mock 降级）。
    """
    logger.info(
        f"[evaluate_compare] text1={len(attempt1_text)} chars, "
        f"text2={len(attempt2_text)} chars"
    )

    if not attempt1_text.strip() and not attempt2_text.strip():
        raise ValueError("两次产出文本均为空，无法评估")

    # ---- 音频分析 ----
    audio1_result = _run_audio_analysis(audio1_paths or [], attempt1_text)
    audio2_result = _run_audio_analysis(audio2_paths or [], attempt2_text)

    audio_info = ""
    if audio1_result or audio2_result:
        audio_info = "\n\n【音频分析结果（已由系统自动计算，请直接使用以下分数）】\n"
        if audio1_result:
            audio_info += (
                f"初次产出 audio_pron = {audio1_result['pronunciation_score']}, "
                f"audio_flu = {audio1_result['fluency_score']} "
                f"(WPM={audio1_result['raw_metrics']['wpm']})\n"
            )
        if audio2_result:
            audio_info += (
                f"二次产出 audio_pron = {audio2_result['pronunciation_score']}, "
                f"audio_flu = {audio2_result['fluency_score']} "
                f"(WPM={audio2_result['raw_metrics']['wpm']})\n"
            )
        audio_info += "请将上述语言能力·发音和话语能力·流利度分数直接填入对应 JSON，不要修改。"

    # ---- 调用 LLM ----
    eval_block = _build_eval_criteria_block(evaluation_criteria)
    system_prompt = _COMPARE_PROMPT.replace("{evaluation_criteria_block}", eval_block)

    user_content = (
        f"【初次产出】\n{_truncate_text(attempt1_text, 3000)}\n\n"
        f"【二次产出】\n{_truncate_text(attempt2_text, 3000)}"
        f"{audio_info}\n\n"
        f"请对比两次产出，按五维标准逐一打分并写对比评语，输出 JSON。"
    )

    raw = _call_llm([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ])
    data = _parse_json(raw)
    comparison = data.get("comparison", [])

    a1_scores: Dict[str, float] = {}
    a2_scores: Dict[str, float] = {}
    dimension_scores: Dict[str, Any] = {}
    for item in comparison:
        dim = item.get("dimension", "")
        a1 = float(item.get("attempt1_score", 0))
        a2 = float(item.get("attempt2_score", 0))
        a1_scores[dim] = a1
        a2_scores[dim] = a2
        change = round(a2 - a1, 1)
        sign = "+" if change >= 0 else ""
        item["change"] = f"{sign}{change}"
        item["weight"] = item.get("weight") or _DIMENSION_WEIGHTS.get(dim, 0.10)
        dimension_scores[dim] = {
            "attempt1": a1,
            "attempt2": a2,
            "change": change,
            "weight": item["weight"],
            "comment": item.get("comment", ""),
        }

    logger.info(f"[evaluate_compare] LLM 返回 {len(comparison)} 个维度")
    result = {
        "attempt1_scores": a1_scores,
        "attempt2_scores": a2_scores,
        "dimension_scores": dimension_scores,
        "comparison": comparison,
    }
    # 翻译各维度的 comment（中文对比评语 → 英文）
    try:
        from services.ai_service import _translate_texts
        comment_map = {item.get("dimension", f"dim_{i}"): item.get("comment", "") for i, item in enumerate(comparison)}
        comment_translations = _translate_texts(comment_map)
        for item in comparison:
            dim = item.get("dimension", "")
            if dim in comment_translations:
                item["comment_en"] = comment_translations[dim]
    except Exception as e:
        logger.warning(f"[evaluate_compare] 翻译失败（不影响流程）: {e}")
    if audio1_result or audio2_result:
        result["audio_analysis"] = {}
        if audio1_result:
            result["audio_analysis"]["attempt1"] = audio1_result["raw_metrics"]
        if audio2_result:
            result["audio_analysis"]["attempt2"] = audio2_result["raw_metrics"]
    return result


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
    失败时抛出异常（无 Mock 降级）。
    """
    logger.info(
        f"[evaluate_target_gaps] gaps={len(gaps)}, "
        f"text2={len(attempt2_text)} chars"
    )

    if not gaps:
        logger.warning("[evaluate_target_gaps] gaps 列表为空")
        return []
    if not attempt2_text.strip():
        raise ValueError("二次产出文本为空，无法评估靶向改善")

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
        f"【初次产出原文】\n{_truncate_text(attempt1_text, 2000)}\n\n"
        f"【二次产出原文】\n{_truncate_text(attempt2_text, 3000)}\n\n"
        f"请逐一判断每个 gap 是否改善，输出 JSON 数组。"
    )

    raw = _call_llm([
        {"role": "system", "content": _TARGET_PROMPT},
        {"role": "user", "content": user_content},
    ])
    data = _parse_json(raw)
    if isinstance(data, list) and len(data) > 0:
        logger.info(f"[evaluate_target_gaps] LLM 返回 {len(data)} 条")
        # 批量翻译靶向评估中的 gap_label/evidence/suggestion（单次 LLM 调用）
        try:
            from services.ai_service import _translate_texts
            translate_fields: Dict[str, str] = {}
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    if item.get("gap_label"):
                        translate_fields[f"gap_label_{i}"] = item["gap_label"]
                    if item.get("evidence"):
                        translate_fields[f"evidence_{i}"] = item["evidence"]
                    if item.get("suggestion"):
                        translate_fields[f"suggestion_{i}"] = item["suggestion"]
            if translate_fields:
                tr = _translate_texts(translate_fields)
                for i, item in enumerate(data):
                    if isinstance(item, dict):
                        if f"gap_label_{i}" in tr:
                            item["gap_label_en"] = tr[f"gap_label_{i}"]
                        if f"evidence_{i}" in tr:
                            item["evidence_en"] = tr[f"evidence_{i}"]
                        if f"suggestion_{i}" in tr:
                            item["suggestion_en"] = tr[f"suggestion_{i}"]
        except Exception as e:
            logger.warning(f"[evaluate_target_gaps] 翻译失败（不影响流程）: {e}")
        return data
    else:
        raise ValueError("LLM 返回格式不是列表")
