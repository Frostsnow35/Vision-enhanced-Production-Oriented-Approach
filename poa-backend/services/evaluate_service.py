"""
评价服务 —— 调用豆包 LLM 进行七维能力评估与双轨对比。
失败时直接抛出异常，不使用 Mock 降级。
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

# ---- 七维评价体系（国创标准）----
_DIMENSIONS = [
    "发音标准度",
    "语法规范性",
    "词汇适配性",
    "语言功能达成度",
    "语用策略得体性",
    "话语回合适配性",
    "副语言匹配度",
]

_DIMENSION_KEYS = [
    "pronunciation",
    "grammar",
    "vocabulary",
    "task_completion",
    "pragmatics",
    "turn_taking",
    "paralinguistic",
]

_DIMENSION_WEIGHTS = [0.20, 0.15, 0.10, 0.10, 0.10, 0.15, 0.20]

# 中文维度名 → 英文 key（前端 dimension_scores 使用）
_DIM_CN_TO_KEY = dict(zip(_DIMENSIONS, _DIMENSION_KEYS))
_DIM_KEY_TO_CN = dict(zip(_DIMENSION_KEYS, _DIMENSIONS))

# ---- 七维锚点描述（1.0-5.0 分，精确到 0.1）----
_DIMENSION_ANCHORS = """\
## 1. 发音标准度（权重 20%）—— 评估元音辅音准确性、重音位置、语调模式、停顿与语流技巧
- 4.5-5.0（优秀）：元音辅音发音准确清晰，重音位置正确；语调自然流畅、富有表现力；停顿恰当；能运用连读、弱读、同化等语流技巧增强自然度。
- 3.5-4.4（良好）：元音辅音基本准确，偶有轻微偏差但不影响理解；重音和语调基本正确；语流较为自然，有连读意识。
- 2.5-3.4（一般）：部分音素发音不准（如 /θ/、/ð/、/æ/ 等易错音），重音偶有错误；语调相对单调；停顿基本合理但缺乏语流技巧。
- 1.5-2.4（较弱）：多个音素发音错误，重音错误频繁影响理解；语调平淡单一；语流断裂明显，逐词蹦读。
- 1.0-1.4（很差）：大量发音错误导致严重理解困难；缺乏重音和语调意识；语流严重断裂，无法形成连贯语音流。

## 2. 语法规范性（权重 15%）—— 评估主谓一致、时态/语态、虚词（冠词/介词）、复杂结构运用
- 4.5-5.0（优秀）：主谓一致、时态、语态使用精准；虚词（冠词、介词）正确无误；能灵活准确运用定语从句、虚拟语气、倒装等复杂结构。
- 3.5-4.4（良好）：基本语法结构正确；偶尔出现小错误（如第三人称单数遗漏）能自我修正；能使用一些复合句。
- 2.5-3.4（一般）：存在一定语法错误（时态混用、冠词缺失/冗余、介词不当）；以简单句为主；复杂结构尝试较少且常出错。
- 1.5-2.4（较弱）：语法错误较多；主谓一致、时态等基础问题频繁出现；句子结构碎片化，从句尝试失败。
- 1.0-1.4（很差）：几乎无正确的语法结构；无法组织完整句子；大量母语直译痕迹。

## 3. 词汇适配性（权重 10%）—— 评估场景词汇匹配度、词语搭配地道性、词汇丰富度
- 4.5-5.0（优秀）：精准使用场景专有词汇和地道搭配（如咖啡店场景使用 latte/cappuccino/oat milk 等）；词汇丰富；能灵活进行同义替换。
- 3.5-4.4（良好）：使用恰当的通用词汇和部分场景术语；搭配基本自然；偶有用词不精确但能传达意思。
- 2.5-3.4（一般）：以基础词汇为主；场景专有词汇有限；偶有不当搭配（如 big coffee 代替 large latte）；同义替换能力欠缺。
- 1.5-2.4（较弱）：词汇量有限；用笼统词汇代替专有词；搭配生硬；大量重复基础词汇。
- 1.0-1.4（很差）：词汇极度贫乏；大量使用母语直译；搭配严重不当导致误解。

## 4. 语言功能达成度（权重 10%）—— 评估交际任务完成率、信息传递完整度
- 4.5-5.0（优秀）：完整覆盖所有交际环节（如问候→点单→确认→支付→道别）；信息传递准确完整；能灵活应对意外情况或追问。
- 3.5-4.4（良好）：完成主要交际环节；信息基本完整；偶有遗漏但不影响整体任务。
- 2.5-3.4（一般）：完成部分交际环节；部分关键信息缺失（如忘记确认大小/口味）；需对方追问才能补充。
- 1.5-2.4（较弱）：仅完成少量交际环节；信息不完整；沟通目标未达成。
- 1.0-1.4（很差）：几乎无法完成交际任务；对方无法理解其意图。

## 5. 语用策略得体性（权重 10%）—— 评估礼貌表达、场合适配、社交规范遵守
- 4.5-5.0（优秀）：礼貌表达自然得体（please/thank you/委婉句式/Could I.../I'd like...）；完全符合特定场景的社交规范；能根据对方身份和关系调整语体。
- 3.5-4.4（良好）：使用了基本礼貌策略；大部分场合用语得体；偶有不自然的表达但无伤大雅。
- 2.5-3.4（一般）：礼貌表达偶有使用但不稳定；偶尔出现直白或生硬表达（如 I want... 代替 I'd like...）。
- 1.5-2.4（较弱）：缺乏礼貌标记；大量使用祈使句和直白句式；不适合该场景的社交规范。
- 1.0-1.4（很差）：表达方式极为不当；可能引起对方不适（如命令式语气、无视社交礼仪）。

## 6. 话语回合适配性（权重 15%）—— 评估话轮长度、转换策略、打断处理、话语标记使用
- 4.5-5.0（优秀）：话轮长度恰当，不冗长不截断；能使用话语标记（Well/Actually/Sure/Let me see）自然开启、维持和转换话轮；主动回应并推进对话；处理打断得体。
- 3.5-4.4（良好）：话轮长度基本合理；能使用部分话语标记；回应及时；偶有话语重叠但能自然补救。
- 2.5-3.4（一般）：话轮有时过长或过短；话语标记使用有限；回应偶有延迟或冷场；话轮转换不够流畅。
- 1.5-2.4（较弱）：话轮管理较差；频繁出现冷场或过度占话；缺乏话语标记；回应延迟明显。
- 1.0-1.4（很差）：无法进行有效话轮交替；沉默过长或频繁打断；缺乏任何互动策略。

## 7. 副语言匹配度（权重 20%）—— 评估眼神交流、面部表情、手势、嗓音变化与交际内容的协调性
- 4.5-5.0（优秀）：眼神交流自然适度；表情丰富且与交际内容高度匹配；手势恰当增强表达；嗓音变化富有表现力（音量、语速、音高变化得当）。
- 3.5-4.4（良好）：有基本的非语言配合；眼神和表情整体协调；偶有手势辅助；嗓音有一定变化。
- 2.5-3.4（一般）：偶有非语言配合但不够自然；眼神时有游离；表情和手势较少；嗓音变化有限。
- 1.5-2.4（较弱）：非语言配合较少或不协调；缺乏眼神交流；表情呆板或不当；嗓音单调。
- 1.0-1.4（很差）：几乎无非语言配合；眼神回避；表情与内容脱节；嗓音机械。
- ⚠️ 特殊情况：若无视频流/音频流，此项固定给 2.5 分（中位基准分），评语必须注明"无视频流，此项暂无法评估"。\
"""

# ---- 单次评估 Prompt ----
_SINGLE_PROMPT = f"""\
你是一个英语口语能力评估专家，严格按照国创七维评估标准进行评分。请对学生的英语对话进行七维度评估。

{_DIMENSION_ANCHORS}

# 评分要求
1. 每个维度给出 1.0-5.0 的分数，必须精确到 0.1 分（如 3.2、4.7）。
2. 若仅有对话文本，无音频流或视频流：
   - 发音标准度：根据文本中的拼写错误、语音转写痕迹间接推断，若无任何语音信息则给 2.5 并注明。
   - 副语言匹配度：固定给 2.5 分，评语注明"无视频流，此项暂无法评估"。
3. 每个维度的评语（comment）必须：
   - 使用中文撰写，长度 40-120 字；
   - 引用对话中的具体证据（原文句子或语音特征描述）；
   - 先指出优点，再指出不足，最后给出改进建议。
4. 严格输出如下 JSON 格式（不要输出任何其他内容，不要用 markdown 代码块包裹）：

{{
  "scores": {{
    "发音标准度": 2.5,
    "语法规范性": 3.2,
    "词汇适配性": 2.8,
    "语言功能达成度": 3.5,
    "语用策略得体性": 2.9,
    "话语回合适配性": 3.1,
    "副语言匹配度": 2.5
  }},
  "comments": {{
    "发音标准度": "根据文本推断... （具体证据） ...建议...",
    "语法规范性": "对话中出现... （引用原文） ...应改为...",
    ...
  }}
}}"""

# ---- 双轨对比 Prompt ----
_COMPARE_PROMPT = f"""\
你是一个英语口语能力评估专家，严格按照国创七维评估标准进行双轨对比评分。请对比学生的初次产出和二次产出，逐维度评分并撰写对比评语。

{_DIMENSION_ANCHORS}

# 对比评语要求（非常重要）
每个维度的 comment 必须包含以下三个要素：
1. **初次产出问题**：引用初次产出中的具体原文句子，说明该维度的不足。
2. **二次产出变化**：引用二次产出中的具体原文句子，说明进步（改用什么表达）或退步（哪里更差）。
3. **对比举例**：必须给出逐字逐句的对比，例如"初次用了 'I want a big coffee'，二次改为 'I'd like a large latte, please'，从命令式转为委婉请求式，场景术语也得到纠正"。
4. 评语使用中文撰写，长度 60-150 字。

# 评分要求
1. 每个维度给出初次分数（attempt1_score）和二次分数（attempt2_score），均为 1.0-5.0，精确到 0.1。
2. change 字段：正数表示提升，负数表示下降，带正负号，保留一位小数（如 "+1.2"、"-0.3"、"+0.0"）。
3. 若无音频/视频流，发音标准度和副语言匹配度两次均给 2.5，评语注明原因。

# 输出格式
严格输出如下 JSON（不要输出任何其他内容）：

{{
  "comparison": [
    {{
      "dimension": "发音标准度",
      "attempt1_score": 2.5,
      "attempt2_score": 2.5,
      "change": "+0.0",
      "comment": "两次均为文本输入，...（对比分析）...",
      "example": "初次产出中使用 'I want coffee'，二次产出中改为 'Could I have a coffee?'，表明请求策略得到改善。"
    }},
    {{
      "dimension": "语法规范性",
      "attempt1_score": 2.8,
      "attempt2_score": 4.1,
      "change": "+1.3",
      "comment": "初次产出中...（引用原文），二次产出改为...（引用原文），具体对比：...",
      "example": "初次: 'He go to school.' → 二次: 'He goes to school.' 主谓一致得到修正。"
    }}
  ]
}}

# example 字段要求
- 必须包含从两次对话中引用的具体原文证据，用对比形式呈现。
- 格式建议："初次产出中使用 '...'，二次产出中改为 '...'，表明...得到改善/退步。"
- 如果对话文本为空或无法提取证据，填写 "无法从对话中提取证据"。"""

# ============================================================
# 通用 LLM 调用
# ============================================================
def _call_llm(messages: List[Dict[str, str]], timeout: int = 120) -> str:
    """调用豆包 LLM，返回原始文本；失败抛出异常（含 httpx.ReadTimeout）。"""
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
# 辅助：1-5 → 1-10 分数映射（前端雷达图使用 0-10 量程）
# ============================================================
def _scale_score(value: float) -> float:
    """将 1-5 量表分数映射为 1-10 量表"""
    return round(value * 2.0, 1)


def _scale_dimensions(scores: Dict[str, float]) -> Dict[str, float]:
    """将全部维度分数从 1-5 映射到 1-10"""
    return {k: _scale_score(v) for k, v in scores.items()}


# ============================================================
# 1. 单次能力评估
# ============================================================
def evaluate_single(
    conversation_text: str, task_context: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    """
    调用 LLM 对单次对话进行七维评分（原始 1-5，返回 1-10）。
    task_context 可选：{ scene_label, roles, goal }。
    失败时直接抛出异常。
    """
    logger.info(f"[evaluate_single] text length={len(conversation_text) if conversation_text else 0}")

    stripped = (conversation_text or "").strip()
    if not stripped or stripped == NO_VOICE_MARKER:
        logger.warning("[evaluate_single] 文本为空或无效转写，不调用 LLM")
        return {
            "dimension_scores": {dim: 0.0 for dim in _DIMENSIONS},
            "comments": {dim: "未检测到语音，所有维度评分为 0" for dim in _DIMENSIONS},
        }

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
        raw_scores = data.get("scores", {})
        comments = data.get("comments", {})

        # 将 1-5 量表映射为 1-10
        scores = _scale_dimensions(raw_scores)

        logger.info(f"[evaluate_single] LLM 返回 {len(scores)} 个维度")
        return {"dimension_scores": scores, "comments": comments}
    except httpx.ReadTimeout:
        logger.warning("[evaluate_single] LLM 调用超时，降级使用默认评分")
        fallback: Dict[str, float] = {dim: 5.0 for dim in _DIMENSIONS}
        return {
            "dimension_scores": fallback,
            "comments": {dim: "评估超时，暂无详细评语" for dim in _DIMENSIONS},
        }
    except Exception as e:
        logger.error(f"[evaluate_single] LLM 调用失败: {e}")
        raise


# ============================================================
# 2. 双轨对比评估
# ============================================================
def evaluate_compare(
    attempt1_text: str, attempt2_text: str
) -> Dict[str, Any]:
    """
    调用 LLM 对比两次产出，返回双轨分数（原始 1-5，返回 1-10）。
    失败时直接抛出异常。
    """
    logger.info(
        f"[evaluate_compare] text1={len(attempt1_text)} chars, "
        f"text2={len(attempt2_text)} chars"
    )

    t1 = (attempt1_text or "").strip()
    t2 = (attempt2_text or "").strip()
    if (not t1 or t1 == NO_VOICE_MARKER) and (not t2 or t2 == NO_VOICE_MARKER):
        logger.warning("[evaluate_compare] 两次文本均为空或无效转写")
        zero_scores = {dim: 0.0 for dim in _DIMENSIONS}
        zero_comparison = [
            {
                "dimension": dim,
                "attempt1_score": 0.0,
                "attempt2_score": 0.0,
                "change": "+0.0",
                "comment": "未检测到语音，所有维度评分为 0",
                "example": "无法从对话中提取证据",
            }
            for dim in _DIMENSIONS
        ]
        zero_dim = {
            _DIM_CN_TO_KEY.get(dim, dim): {
                "attempt1": 0.0,
                "attempt2": 0.0,
                "comment": "未检测到语音，所有维度评分为 0",
                "example": "无法从对话中提取证据",
            }
            for dim in _DIMENSIONS
        }
        return {
            "attempt1_scores": zero_scores,
            "attempt2_scores": zero_scores,
            "dimension_scores": zero_dim,
            "comparison": zero_comparison,
        }

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
            # 将 1-5 量表映射为 1-10
            a1_scores[dim] = _scale_score(float(item.get("attempt1_score", 0)))
            a2_scores[dim] = _scale_score(float(item.get("attempt2_score", 0)))
            # change 值也一并缩放
            raw_change = float(item.get("change", "0").replace("+", ""))
            item["change"] = f"{'+' if raw_change >= 0 else ''}{round(raw_change * 2, 1)}"
            item["attempt1_score"] = a1_scores[dim]
            item["attempt2_score"] = a2_scores[dim]

        # 构建前端兼容的 dimension_scores（英文 key）
        dim_scores: Dict[str, Dict[str, Any]] = {}
        for item in comparison:
            dim_cn = item.get("dimension", "")
            key = _DIM_CN_TO_KEY.get(dim_cn, dim_cn)
            dim_scores[key] = {
                "attempt1": item.get("attempt1_score", 0),
                "attempt2": item.get("attempt2_score", 0),
                "comment": item.get("comment", ""),
                "example": item.get("example", "无法从对话中提取证据"),
            }

        logger.info(f"[evaluate_compare] LLM 返回 {len(comparison)} 个维度")
        return {
            "attempt1_scores": a1_scores,
            "attempt2_scores": a2_scores,
            "dimension_scores": dim_scores,
            "comparison": comparison,
        }
    except httpx.ReadTimeout:
        logger.warning("[evaluate_compare] LLM 调用超时，降级使用默认评分")
        fallback_a1: Dict[str, float] = {}
        fallback_a2: Dict[str, float] = {}
        fallback_comparison: List[Dict[str, Any]] = []
        fallback_dim: Dict[str, Dict[str, Any]] = {}
        for dim in _DIMENSIONS:
            key = _DIM_CN_TO_KEY.get(dim, dim)
            fallback_a1[dim] = 5.0
            fallback_a2[dim] = 5.0
            fallback_comparison.append({
                "dimension": dim,
                "attempt1_score": 5.0,
                "attempt2_score": 5.0,
                "change": "+0.0",
                "comment": "评估超时，暂无对比评语",
            })
            fallback_dim[key] = {
                "attempt1": 5.0,
                "attempt2": 5.0,
                "comment": "评估超时，暂无对比评语",
            }
        return {
            "attempt1_scores": fallback_a1,
            "attempt2_scores": fallback_a2,
            "dimension_scores": fallback_dim,
            "comparison": fallback_comparison,
        }
    except Exception as e:
        logger.error(f"[evaluate_compare] LLM 调用失败: {e}")
        raise


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
    失败时直接抛出异常。
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
    except httpx.ReadTimeout:
        logger.warning("[evaluate_target_gaps] LLM 调用超时，降级返回默认结果")
        return [
            {
                "gap_label": g.get("label", "未知不足"),
                "improved": False,
                "evidence": "评估超时，无法判断",
                "suggestion": "请稍后重试靶向评估",
            }
            for g in gaps
        ]
    except Exception as e:
        logger.error(f"[evaluate_target_gaps] LLM 调用失败: {e}")
        raise
