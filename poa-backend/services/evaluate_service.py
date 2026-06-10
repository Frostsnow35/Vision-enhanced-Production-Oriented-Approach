"""
评价服务 —— 调用豆包 LLM 进行七维能力评估与双轨对比。
LLM 不可用时自动降级为 Mock 随机数据。
支持音频分析：传入 audio_paths 时，发音 + 副语言维度由本地 Whisper 分析给出真实分数。
"""
import json
import logging
import random
from typing import Any, Dict, List, Optional

import httpx

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID, DOUBAO_BASE_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evaluate_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

# ---- 七维评价体系（严格对齐 Excel 评分表） ----
_DIMENSIONS = [
    "发音标准度",
    "语法规范性",
    "词汇适配性",
    "语言功能达成度",
    "语用策略得体性",
    "话语回合适配性",
    "副语言匹配度",
]

# 各维度权重（取自 Excel H 列）
_DIMENSION_WEIGHTS: Dict[str, float] = {
    "发音标准度": 0.20,       # Excel 4 行子维度均占 20% 权重
    "语法规范性": 0.15,
    "词汇适配性": 0.10,
    "语言功能达成度": 0.10,
    "语用策略得体性": 0.10,
    "话语回合适配性": 0.15,
    "副语言匹配度": 0.20,
}

# ---- 单次评估 Prompt（严格对齐 Excel 七维评分标准） ----
_SINGLE_PROMPT = """\
你是一个严格、挑剔的英语口语评估专家。请严格按照以下【国创七维评估表】的评分标准，对学生的对话文本进行评分。

【评分纪律 — 必须遵守】
- 默认基准分是 2.5 分，只有表现明显优于基准时才给更高分
- 4 分及以上必须要求该维度几乎无缺陷
- 不要因为对话"完成了任务"就自动给高分——要仔细检查语法、用词、策略的每个细节
- 如果学生的句子短、词汇单一、缺少礼貌用语，分数应该偏低（2.0-3.0）
- 评语中必须引用原文的具体错误，不能泛泛而谈

【七维评分标准（严格按 Excel 表格）】
1. 发音标准度（权重 20%）
   1.1 元音辅音：系统音素错误率
       1分：错误率≥35%，单词可懂度<50%；2分：错误率20-34%，可懂度50-70%；
       3分：错误率<15%，可懂度≥70%；4分：仅复杂词有微小偏差，可懂度≥80%；
       5分：无系统性错误，可懂度≥90%
   1.2 重音：核心关键词重音准确率
       1分：<50%；2分：50-70%；3分：≥70%；4分：≥80%；5分：≥90%
   1.3 语调与意群停顿：语气辨识度
       1分：<50%；2分：50-70%；3分：≥70%；4分：≥80%；5分：≥90%
   1.4 语流技巧（连读弱读失爆）：使用率
       1分：<25%；2分：25-49%；3分：≥50%；4分：≥70%；5分：≥90%
   若用户消息中已给出 audio_pron（由音频分析自动计算），则发音标准度直接采用 audio_pron，comment 写"由音频分析自动评分"。

2. 语法规范性（权重 15%）
   2.1 主谓一致、时态、语态：准确率
       1分：错误率≥35%；2分：20-34%；3分：<15%，准确率≥70%；4分：准确率≥80%；5分：准确率≥90%
   2.2 冠词、介词、代词等虚词：准确率
       1分：错误率≥35%；2分：20-34%；3分：<15%，准确率≥70%；4分：准确率≥80%；5分：准确率≥90%
   2.3 从句、被动等复杂结构：正确使用
       1分：完全无法使用；2分：错误率≥50%；3分：可使用1-2种，准确率≥70%；
       4分：正确使用多种，准确率≥80%；5分：熟练使用，准确率≥90%

3. 词汇适配性（权重 10%）
   3.1 场景匹配：用词与场景是否恰当
       1分：用词严重脱节；2分：部分脱节，频繁不当；3分：基本匹配，覆盖大部分；
       4分：匹配度75%；5分：高度匹配，覆盖80%+，用词地道
   3.2 词语搭配：固定搭配准确率
       1分：错误率≥35%；2分：20-34%；3分：<15%，准确率≥70%；4分：准确率≥80%；5分：准确率≥85%

4. 语言功能达成度（权重 10%）
   4.1 主要交际任务完成度
       1分：完成率<50%；2分：50-69%；3分：≥70%，核心无遗漏；4分：≥80%；5分：≥85%，精准高效
   4.2 信息完整性
       1分：完整度<50%；2分：50-69%；3分：≥70%逻辑通顺；4分：≥80%逻辑清晰；5分：≥85%且补充有效细节

5. 语用策略得体性（权重 10%）
   5.1 礼貌表达使用率
       1分：<30%；2分：30-49%；3分：≥50%（含 I think/Could you… 等）；4分：≥70%；5分：≥85%
   5.2 场景适配：是否符合场合/对象
       1分：适配率<50%；2分：50-69%；3分：≥70%；4分：≥80%；5分：≥85%，精准匹配

6. 话语回合适配性（权重 15%）
   6.1 话轮长度：单轮发言占比
       1分：失衡率≥50%（>90%或<10%）；2分：30-49%；3分：<30%（30-70%合理）；4分：<20%；5分：<10%自然
   6.2 话轮转换策略：转换信号使用率
       1分：<30%；2分：30-49%；3分：≥50%；4分：≥70%；5分：≥90%
   6.3 打断与重叠处理
       1分：不当打断率≥35%；2分：20-34%；3分：<15%；4分：<10%；5分：<5%

7. 副语言匹配度（权重 20%）
   7.1 眼神接触（需视频）；7.2 面部表情（需视频）；7.3 手势身体姿态（需视频）；7.4 嗓音与音量
   若用户消息中已给出 audio_flu（基于 WPM 和停顿频率计算），副语言匹配度直接采用 audio_flu，comment 写"由音频分析自动评分（基于流利度指标）"。
   若无音频流，给固定分 2.5。

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
    ...
  }
}
每个 comment 必须引用对话中的具体证据（原文句子或描述），长度 30-80 字。"""

# ---- 双轨对比 Prompt（严格对齐 Excel 七维） ----
_COMPARE_PROMPT = """\
你是一个严格、挑剔的英语口语评估专家。请严格按照【国创七维评估表】的评分标准（已在上文给出，1-5分，权重见下），对比学生的初次产出和二次产出，对每个维度评分并写对比评语。

【评分纪律】
- 默认基准分 2.5 分，只对明显优秀的维度给 4+
- 仔细对比两次对话，引用原文中的具体证据说明分数变化
- 如果二次产出只是简单重复初次内容，分数不应明显提高

【七维度及权重】
1. 发音标准度（20%）：元音辅音、重音、语调、语流
2. 语法规范性（15%）：主谓一致、虚词、复杂结构
3. 词汇适配性（10%）：场景匹配、词语搭配
4. 语言功能达成度（10%）：任务完成度、信息完整性
5. 语用策略得体性（10%）：礼貌表达、场景适配
6. 话语回合适配性（15%）：话轮长度、转换策略、打断处理
7. 副语言匹配度（20%）：眼神、表情、手势、嗓音

【评分约束】
- 若用户消息中已给出 audio_pron，发音标准度直接采用该分数（由音频分析计算），comment 注明"由音频分析自动评分"。
- 若用户消息中已给出 audio_flu，副语言匹配度直接采用该分数，comment 注明"由音频分析自动评分（基于流利度指标）"。
- 否则按对话文本和 Excel 评分标准评估。

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
      "dimension": "发音标准度",
      "attempt1_score": 2.5,
      "attempt2_score": 4.0,
      "change": "+1.5",
      "weight": 0.20,
      "comment": "初次：'th' 音错误率较高（如 'think' 念成 'tink'）；二次：'th' 音基本正确，复杂词 'thoroughly' 仍有微偏差；综合提升 1.5 分。"
    },
    ...（共 7 个维度）
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
    import re
    text = resp.json()["choices"][0]["message"]["content"]
    return re.sub(r'</?think[^>]*>', '', text).strip()


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


def _run_audio_analysis(audio_paths: List[str]) -> Optional[Dict[str, Any]]:
    """运行音频分析，失败返回 None"""
    if not audio_paths:
        return None
    try:
        from services.audio_analysis_service import analyze_audio
        return analyze_audio(audio_paths)
    except Exception as e:
        logger.warning(f"[evaluate] 音频分析失败: {e}")
        return None


# ============================================================
# 1. 单次能力评估
# ============================================================
def evaluate_single(
    conversation_text: str,
    task_context: Dict[str, Any] | None = None,
    audio_paths: List[str] | None = None,
) -> Dict[str, Any]:
    """
    调用 LLM 对单次对话进行七维评分（1-5，一位小数）。
    
    @param conversation_text 对话文本
    @param task_context 可选：{ scene_label, roles, goal }
    @param audio_paths 可选：音频文件路径列表，传入时发音+副语言由本地分析给出真实分数
    @return { dimension_scores, comments, audio_analysis }
    失败自动降级 Mock。
    """
    logger.info(f"[evaluate_single] text length={len(conversation_text) if conversation_text else 0}")

    if not conversation_text.strip():
        logger.warning("[evaluate_single] 空文本，返回空 scores")
        return {"dimension_scores": {}, "comments": {}}

    # ---- 音频分析 ----
    audio_result = _run_audio_analysis(audio_paths or [])
    audio_info = ""
    if audio_result:
        audio_info = (
            f"\n\n【音频分析结果（已由系统自动计算，请直接使用以下分数）】\n"
            f"audio_pron(发音标准度) = {audio_result['pronunciation_score']}\n"
            f"audio_flu(副语言匹配度/流利度) = {audio_result['fluency_score']}\n"
            f"流利度指标: WPM={audio_result['raw_metrics']['wpm']}, "
            f"停顿频率={audio_result['raw_metrics']['pause_count_per_minute']}/分钟, "
            f"平均停顿时长={audio_result['raw_metrics']['average_pause_duration_seconds']}秒, "
            f"词级置信度均值={audio_result['raw_metrics']['mean_confidence']}\n"
            f"请将上述发音标准度和副语言匹配度分数直接填入 JSON，不要修改。"
        )

    # ---- 构建 prompt ----
    ctx = task_context or {}
    scene = ctx.get("scene_label", "未知场景")
    roles = ctx.get("roles", "未知角色")
    goal = ctx.get("goal", "未知目标")

    user_content = (
        f"场景: {scene}\n角色: {roles}\n目标: {goal}\n\n"
        f"学生对话文本:\n{conversation_text[:2000]}"
        f"{audio_info}\n\n"
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
        result = {"dimension_scores": scores, "comments": comments}
        if audio_result:
            result["audio_analysis"] = audio_result["raw_metrics"]
        return result
    except Exception as e:
        logger.warning(f"[evaluate_single] LLM 调用失败: {e}，降级 Mock")

    # ---- 降级: Mock 随机分数 ----
    fallback_scores: Dict[str, float] = {}
    base = 2.5 + (0.5 if len(conversation_text) > 200 else 0)
    for dim in _DIMENSIONS:
        # 如果有音频分析结果，使用真实分数
        if audio_result and dim == "发音标准度":
            fallback_scores[dim] = audio_result["pronunciation_score"]
        elif audio_result and dim == "副语言匹配度":
            fallback_scores[dim] = audio_result["fluency_score"]
        else:
            score = round(base + random.uniform(-0.8, 1.0), 1)
            fallback_scores[dim] = max(1.0, min(5.0, score))

    result = {"dimension_scores": fallback_scores, "comments": {}}
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
) -> Dict[str, Any]:
    """
    调用 LLM 对比两次产出，返回双轨分数 + 各维度变化 + 对比评语。
    
    @param attempt1_text 初次产出文本
    @param attempt2_text 二次产出文本
    @param audio1_paths 初次产出音频路径列表
    @param audio2_paths 二次产出音频路径列表
    失败自动降级 Mock。
    """
    logger.info(
        f"[evaluate_compare] text1={len(attempt1_text)} chars, "
        f"text2={len(attempt2_text)} chars"
    )

    if not attempt1_text.strip() and not attempt2_text.strip():
        logger.warning("[evaluate_compare] 空文本")
        return {"attempt1_scores": {}, "attempt2_scores": {}, "comparison": []}

    # ---- 音频分析 ----
    audio1_result = _run_audio_analysis(audio1_paths or [])
    audio2_result = _run_audio_analysis(audio2_paths or [])

    audio_info = ""
    if audio1_result or audio2_result:
        audio_info = "\n\n【音频分析结果（已由系统自动计算，请直接使用以下分数）】\n"
        if audio1_result:
            audio_info += (
                f"初次产出 audio_pron = {audio1_result['pronunciation_score']}, "
                f"audio_flu = {audio1_result['fluency_score']} "
                f"(WPM={audio1_result['raw_metrics']['wpm']}, "
                f"pause_freq={audio1_result['raw_metrics']['pause_count_per_minute']}/min)\n"
            )
        if audio2_result:
            audio_info += (
                f"二次产出 audio_pron = {audio2_result['pronunciation_score']}, "
                f"audio_flu = {audio2_result['fluency_score']} "
                f"(WPM={audio2_result['raw_metrics']['wpm']}, "
                f"pause_freq={audio2_result['raw_metrics']['pause_count_per_minute']}/min)\n"
            )
        audio_info += "请将上述发音标准度和副语言匹配度分数直接填入对应 JSON，不要修改。"

    # ---- 调用 LLM ----
    user_content = (
        f"【初次产出】\n{attempt1_text[:1500]}\n\n"
        f"【二次产出】\n{attempt2_text[:1500]}"
        f"{audio_info}\n\n"
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
        dimension_scores: Dict[str, Any] = {}
        for item in comparison:
            dim = item.get("dimension", "")
            a1 = float(item.get("attempt1_score", 0))
            a2 = float(item.get("attempt2_score", 0))
            a1_scores[dim] = a1
            a2_scores[dim] = a2
            change = round(a2 - a1, 1)
            sign = "+" if change >= 0 else ""
            # 为每个维度补充 weight 和统一 change 字段
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
        if audio1_result or audio2_result:
            result["audio_analysis"] = {}
            if audio1_result:
                result["audio_analysis"]["attempt1"] = audio1_result["raw_metrics"]
            if audio2_result:
                result["audio_analysis"]["attempt2"] = audio2_result["raw_metrics"]
        return result
    except Exception as e:
        logger.warning(f"[evaluate_compare] LLM 调用失败: {e}，降级 Mock")

    # ---- 降级: Mock 随机对比数据 ----
    a1_scores = {}
    a2_scores = {}
    comparison = []
    dimension_scores = {}

    for dim in _DIMENSIONS:
        # 如果有音频分析结果，使用真实分数
        if audio1_result and dim == "发音标准度":
            a1_s = audio1_result["pronunciation_score"]
        elif audio1_result and dim == "副语言匹配度":
            a1_s = audio1_result["fluency_score"]
        else:
            a1_s = round(2.0 + random.uniform(0, 1.5), 1)

        if audio2_result and dim == "发音标准度":
            a2_s = audio2_result["pronunciation_score"]
        elif audio2_result and dim == "副语言匹配度":
            a2_s = audio2_result["fluency_score"]
        else:
            improvement = round(0.5 + random.uniform(0, 1.0), 1)
            a2_s = a1_s + improvement

        a1_scores[dim] = max(1.0, min(5.0, a1_s))
        a2_scores[dim] = max(1.0, min(5.0, a2_s))

        change_val = round(a2_scores[dim] - a1_scores[dim], 1)
        sign = "+" if change_val >= 0 else ""
        weight = _DIMENSION_WEIGHTS.get(dim, 0.10)
        comment = random.choice(_MOCK_COMMENTS.get(dim, ["表现有所提升。"]))

        comparison.append({
            "dimension": dim,
            "attempt1_score": a1_scores[dim],
            "attempt2_score": a2_scores[dim],
            "change": f"{sign}{change_val}",
            "weight": weight,
            "comment": comment,
        })
        dimension_scores[dim] = {
            "attempt1": a1_scores[dim],
            "attempt2": a2_scores[dim],
            "change": change_val,
            "weight": weight,
            "comment": comment,
        }

    result = {
        "attempt1_scores": a1_scores,
        "attempt2_scores": a2_scores,
        "dimension_scores": dimension_scores,
        "comparison": comparison,
    }
    if audio1_result or audio2_result:
        result["audio_analysis"] = {}
        if audio1_result:
            result["audio_analysis"]["attempt1"] = audio1_result["raw_metrics"]
        if audio2_result:
            result["audio_analysis"]["attempt2"] = audio2_result["raw_metrics"]
    return result


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
