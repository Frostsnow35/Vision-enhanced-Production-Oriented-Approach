"""
AI 服务 —— requests 直连豆包 Chat API。
所有函数: LLM 优先 → 失败自动降级 Mock → 返回格式固定。
"""
import hashlib
import json
import logging
import os
import random
import time
import base64
from typing import Any, Dict, List

import requests
from sqlalchemy.orm import Session

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, ARK_MODEL_ID, DOUBAO_MODEL_ID
from models import Scenario, POATask

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("ai_service")

CHAT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
_TIMEOUT = 120
_MAX_TOKENS = 1000

# ============================================================
# 通用 LLM 调用
# ============================================================
def _call_doubao(messages: List[Dict[str, Any]], max_tokens: int = _MAX_TOKENS, model: str = "") -> str:
    """调用豆包 API，返回 content。model 为空时使用默认模型。失败抛 RuntimeError。"""
    body = {"model": model or DOUBAO_MODEL_ID, "messages": messages, "max_tokens": max_tokens}
    t0 = time.time()
    resp = requests.post(
        CHAT_URL,
        headers={"Authorization": f"Bearer {DOUBAO_API_KEY}", "Content-Type": "application/json"},
        json=body,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    msg = resp.json()["choices"][0]["message"]
    content = (msg.get("content") or "").strip()
    reasoning = (msg.get("reasoning_content") or "").strip()

    # 修复 thinking 模型输出的 content 为残片（如仅 "}"）的问题
    if len(content) < 20 and reasoning and len(reasoning) > len(content):
        # 从 reasoning 末尾提取 JSON（内容通常在最后）
        import re as _re
        m = _re.search(r'\{[^{}]*"gaps"|\{[^{}]*"scores"|\{[^{}]*"comparison"|\{[^{}]*"scene_label"|\{[^{}]*"label"', reasoning)
        if m:
            # 从匹配位置截取到 reasoning 末尾，再提取完整 JSON
            tail = reasoning[m.start():]
            try:
                _parse_json(tail)
                content = tail
            except Exception:
                pass

    logger.info(f"  [LLM] {resp.status_code} {time.time()-t0:.1f}s")
    return content


def _parse_json(raw: str) -> Any:
    """去除 markdown 代码块后解析 JSON，仅提取第一个 JSON 对象/数组。"""
    import re
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].startswith("```"): lines = lines[:-1]
        raw = "\n".join(lines)

    # 提取第一个完整 JSON 对象或数组（处理 LLM 追加额外文本的情况）
    raw = raw.strip()
    if raw.startswith("{"):
        # 找到匹配的 }
        depth, end = 0, 0
        for i, ch in enumerate(raw):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0: end = i + 1; break
        if end: raw = raw[:end]
    elif raw.startswith("["):
        depth, end = 0, 0
        for i, ch in enumerate(raw):
            if ch == "[": depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0: end = i + 1; break
        if end: raw = raw[:end]

    return json.loads(raw)


_INVALID_PATTERNS = ("[语音消息]", "[voice message]", "[audio]", "[inaudible]", "[unintelligible]")

def _is_empty_or_placeholder(text: str) -> bool:
    """检查文本是否为空/空格/语音占位符，表示无有效输入。"""
    t = text.strip()
    if not t: return True
    if len(t) < 5: return True
    for p in _INVALID_PATTERNS:
        if p in t.lower(): return True
    return False

_NO_VALID_INPUT = {"error": "no_valid_input", "message": "未检测到有效语音内容，请重新录音。"}


# ============================================================
# Prompt 模板
# ============================================================
_SCENE_PROMPT = """你是一个英语教学场景分析专家。分析这张照片，严格输出 JSON:
{"scene_label":"场景名称","poa_task":{"roles":"A:角色; B:角色","goal":"交际目标","context_constraints":"约束条件","evaluation_criteria":["维度1","维度2"]},"variant_plot":"变体情节"}"""

_DIAGNOSIS_PROMPT = """你是英语口语诊断专家。找出学生对话中的 Top 3 不足，返回 JSON:
{"gaps":[{"label":"不足分类","evidence_sentence":"原文证据","explanation":"为什么需要改进及正确建议"}]}"""

_SINGLE_PROMPT = """你是英语口语评估专家。请严格按照以下七维标准评分(1-5,精确到0.1)，并写中文评语。返回 JSON:
{"scores":{"发音标准度":0,"语法规范性":0,"词汇适配性":0,"语言功能达成度":0,"语用策略得体性":0,"话语回合适配性":0,"副语言匹配度":0},
 "comments":{"发音标准度":"评语","语法规范性":"评语","词汇适配性":"评语","语言功能达成度":"评语","语用策略得体性":"评语","话语回合适配性":"评语","副语言匹配度":"评语"}}

【七维评分锚点 — 必须严格参照】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%,连读弱读自然
2.语法规范性: 1=错误率>=35%,句子混乱 | 3=错误<15%,核心意思可懂 | 5=错误<5%,稳定正确,能使用复杂结构
3.词汇适配性: 1=用词与场景脱节 | 3=基本匹配,准确率>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=任务完成率<50% | 3=完成率>=70%,意图可理解 | 5=完成率>=85%,高效完成
5.语用策略得体性: 1=礼貌表达率<30%,生硬 | 3=礼貌率>=50%,使用基础句式 | 5=礼貌率>=85%,灵活调整策略
6.话语回合适配性: 1=话轮失衡>=50%,无转换信号 | 3=失衡<30%,有基础转换 | 5=失衡<10%,熟练使用多种转换句式
7.副语言匹配度: 仅音频/文本输入 -> 固定2.5分,评语写"无视频流,副语言维度暂无法评估"。有视频时: 1=有效眼神<30% | 3=>=50% | 5=>=90%表情手势精准

【评语要求】每个 comment 必须引用对话中的具体证据(原句或描述)，长度 20-60 字。"""

_COMPARE_PROMPT = """你是英语口语评估专家。对比初次和二次对话，对七维逐项打分并写对比评语。返回 JSON:
{"comparison":[
  {"dimension":"发音标准度","attempt1_score":2.5,"attempt2_score":3.5,"change":"+1.0",
   "comment":"评语（必须引用两次对话的原文举例，清晰说明分数变化原因）"}]}

【七维评分锚点 — 与单次评估标准完全一致】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%
2.语法规范性: 1=错误率>=35% | 3=错误<15% | 5=错误<5%,稳定正确
3.词汇适配性: 1=用词脱节 | 3=基本匹配>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=完成率<50% | 3=>=70% | 5=>=85%,高效完成
5.语用策略得体性: 1=礼貌率<30% | 3=>=50% | 5=>=85%,灵活策略
6.话语回合适配性: 1=失衡>=50% | 3=<30% | 5=<10%,熟练转换
7.副语言匹配度: 仅文本/音频 -> 两次均固定2.5,change="+0.0",评语注明无视频流。有视频按锚点评分。

【对比评语要求】
每个 comment 必须包含: 1)初次产出中的具体证据(原句) 2)二次产出中的具体证据(原句) 3)进步或退步的具体原因。
示例: "初次使用了 'I want coffee'(祈使句直接), 二次改为 'Could I have a latte, please?'(委婉请求+please), 礼貌策略从直接型升级为委婉型,语用得体性显著提升。"
"""

_EXERCISES_PROMPT = """你是英语教学练习设计专家。根据学生的不足列表，设计2~3道练习题。返回 JSON:
{"exercises":[{"id":1,"type":"multiple_choice","gap_target":"对应的不足标签","question":"题目描述","options":[{"key":"A","text":"选项A"},{"key":"B","text":"选项B"},{"key":"C","text":"选项C"}],"answer":"B","feedback":"详细解释为什么选这个答案"}]}
type 是 multiple_choice 或 fill_in_blank。每个练习必须针对具体的不足，题干使用中文，选项/答案使用英文。"""

_INPUTPACK_PROMPT = """你是英语教学材料设计师。根据学生的不足列表，设计学习材料。返回 JSON:
{"scene_chunks":[{"chunk":"英文短语","meaning":"中文释义","usage":"使用场景"}],
 "functional_sentences":[{"function":"功能名","sentence":"英文例句"}],
 "demo_dialogue":"示范对话(英文,标注说话人)",
 "strategy_tip":"学习策略提示(中文)"}"""

_MOCK_DIAGNOSIS = {
    "gaps": [
        {"label": "请求句式-过于直接",
         "evidence_sentence": "(使用祈使句或直接表达)",
         "explanation": "在服务场景中应使用委婉请求句式如 'I'd like...'、'Could I...' 代替直接的 'I want...' 或 'Give me...'。"},
        {"label": "场景词汇-不够准确",
         "evidence_sentence": "(使用通用词汇代替场景专有表达)",
         "explanation": "每个场景有其核心词汇，应使用场景专有术语而非泛化表达，使沟通更精准地​道。"},
        {"label": "互动确认-话轮衔接不足",
         "evidence_sentence": "(回应简短，缺乏确认)",
         "explanation": "对话中应对对方提问做简短确认再用完整句式回应，使用 please/thank you 等礼貌标记。"},
    ]
}

_MOCK_SINGLE = {
    "scores": {"发音标准度": 2.5, "语法规范性": 2.5, "词汇适配性": 2.5,
               "语言功能达成度": 2.5, "语用策略得体性": 2.5, "话语回合适配性": 2.5, "副语言匹配度": 2.5},
    "comments": {"发音标准度": "无音频流，给基准分2.5。", "语法规范性": "Mock降级数据，请重试。",
                 "词汇适配性": "Mock降级数据，请重试。", "语言功能达成度": "Mock降级数据，请重试。",
                 "语用策略得体性": "Mock降级数据，请重试。", "话语回合适配性": "Mock降级数据，请重试。",
                 "副语言匹配度": "无视频流，给基准分2.5。"}
}

_MOCK_INPUTPACK = {
    "scene_chunks": [
        {"chunk": "I'd like a ...", "meaning": "我想要一杯...", "usage": "点单开头"},
        {"chunk": "with oat milk", "meaning": "加燕麦奶", "usage": "乳制品替代"},
        {"chunk": "for here / to go", "meaning": "堂食/带走", "usage": "回应咖啡师"},
    ],
    "functional_sentences": [
        {"function": "礼貌点单", "sentence": "Hi, I'd like a large iced latte, please."},
        {"function": "特殊需求", "sentence": "Could I have that with oat milk? I'm lactose intolerant."},
        {"function": "确认回应", "sentence": "For here, please. Thank you!"},
    ],
    "demo_dialogue": (
        "Barista: Hi! What can I get for you?\n"
        "Customer: I'd like a medium iced latte, please.\n"
        "Barista: For here or to go?\n"
        "Customer: For here, thanks. And could I have that with oat milk?\n"
        "Barista: Of course! That'll be $5.50.\n"
        "Customer: Here's my card. Thank you!"
    ),
    "strategy_tip": "公式: 问候 + I'd like + 大小 + 温度 + 品类 + 定制 + please。没听清用 'Sorry, could you repeat that?'。",
}


# ============================================================
# 1. 场景分析
# ============================================================
def analyze_scenario(image_path: str) -> Dict[str, Any]:
    logger.info(f"[analyze_scenario] path={image_path}")
    if not os.path.isfile(image_path):
        raise RuntimeError(f"视觉模型调用失败: 文件不存在 {image_path}")

    try:
        ext = os.path.splitext(image_path)[-1].lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        data_url = f"data:{mime};base64,{b64}"
    except OSError as e:
        raise RuntimeError(f"视觉模型调用失败: 读取图片失败 {e}")

    try:
        raw = _call_doubao([{"role": "user", "content": [
            {"type": "text", "text": _SCENE_PROMPT},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}], model="doubao-seed-2-0-mini-260428")
    except Exception as e:
        raise RuntimeError(f"视觉模型调用失败: API请求失败 {e}")

    try:
        p = _parse_json(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"视觉模型调用失败: JSON解析失败 {e}")

    poa = p.get("poa_task", {})
    ec = poa.get("evaluation_criteria", [])
    if isinstance(ec, list):
        ec = "\n".join(f"{i}. {c}" for i, c in enumerate(ec, 1))

    result = {
        "scene_label": p.get("scene_label", ""),
        "roles": poa.get("roles", ""),
        "goal": poa.get("goal", ""),
        "context_constraints": poa.get("context_constraints", ""),
        "evaluation_criteria": ec if isinstance(ec, str) else str(ec),
        "variant_plot": p.get("variant_plot", ""),
    }
    logger.info(f"  scene_label={result['scene_label']}")
    return result


# ============================================================
# 1b. 缓存查询
# ============================================================
def get_or_analyze_scenario(image_path: str, db: Session) -> Dict[str, Any]:
    try:
        with open(image_path, "rb") as f:
            h = hashlib.md5(f.read()).hexdigest()
    except OSError:
        return analyze_scenario(image_path)

    ex = db.query(Scenario).filter(Scenario.image_hash == h).first()
    if ex:
        t = db.query(POATask).filter(POATask.scenario_id == ex.id).order_by(POATask.created_at.desc()).first()
        if t:
            logger.info(f"[get_or_analyze] cache hit scenario_id={ex.id}")
            return {"scenario_id": ex.id, "scene_label": ex.scene_label, "roles": t.roles or "", "goal": t.goal or "",
                    "context_constraints": t.context_constraints or "", "evaluation_criteria": t.evaluation_criteria or "",
                    "variant_plot": t.variant_plot or ""}

    result = analyze_scenario(image_path)
    scenario_id = None
    try:
        s = Scenario(image_path=image_path, image_hash=h, scene_label=result["scene_label"])
        db.add(s); db.flush()
        scenario_id = s.id
        db.add(POATask(scenario_id=s.id, roles=result["roles"], goal=result["goal"],
                        context_constraints=result["context_constraints"],
                        evaluation_criteria=result["evaluation_criteria"], variant_plot=result["variant_plot"]))
        db.commit()
    except Exception as e:
        db.rollback(); logger.error(f"  DB write failed: {e}")
    result["scenario_id"] = scenario_id
    return result


# ============================================================
# 2. 产出诊断 → LLM 调用 + 降级 fallback
# ============================================================

# 诊断 prompt
_DIAGNOSIS_PROMPT = """\
你是一个英语口语诊断专家。分析学生的对话文本，找出 Top 3 语言/语用不足。
严格输出如下 JSON（不要输出其他内容）：
{
  "gaps": [
    {
      "label": "不足分类（如：请求句式-过于直接）",
      "evidence_sentence": "原文中使用不当的句子原文",
      "explanation": "详细解释为什么需要改进，并给出正确/更优的表达建议"
    }
  ]
}"""


def get_diagnosis_fallback() -> Dict[str, Any]:
    """
    返回固定的 Top 3 不足（通用版，不绑定特定场景）。
    当真实 LLM 调用失败或未启用时使用。
    """
    return {
        "gaps": [
            {
                "label": "话轮衔接-缺乏互动确认",
                "evidence_sentence": "(对方提问后直接作答，缺少衔接词)",
                "explanation": (
                    "在真实对话中，回应对方提问前应先做简短确认（acknowledgement），"
                    "例如 'Sure', 'Of course', 'Let me see' 等，再展开回答。"
                    "这样能让对话更自然，也给对方一个你理解了问题的信号。"
                    "建议：在回答前加一句衔接语，如 'Sure, I'd like...' "
                    "而不是直接给出答案。"
                ),
            },
            {
                "label": "请求句式-过于直接",
                "evidence_sentence": "(使用 'I want...' / 'Give me...' 等直接表达)",
                "explanation": (
                    "在英语服务场景中，使用 'I want...' 或祈使句 'Give me...' "
                    "会显得生硬甚至不礼貌。母语者通常使用 'I'd like...'、"
                    "'Could I have...'、'May I...' 等委婉句式。"
                    "建议：用 'I'd like...' 替代 'I want...'，"
                    "用 'Could I get...' 替代 'Give me...'。"
                ),
            },
            {
                "label": "场景词汇-不够丰富或不够准确",
                "evidence_sentence": "(使用了过于泛化的词汇，缺少场景专有表达)",
                "explanation": (
                    "每个交际场景都有其核心词汇和固定搭配。使用过于泛化的词汇"
                    "（如 'thing', 'stuff', 'big', 'get'）会让表达显得不够地道。"
                    "建议：积累场景特定的词汇，例如咖啡店的 'latte/cappuccino/oat milk'，"
                    "图书馆的 'check out/renew/overdue'，餐厅的 'appetizer/main course/bill'。"
                ),
            },
        ]
    }


def diagnose_attempt(attempt_text: str) -> Dict[str, Any]:
    """
    对学生的一次作答文本进行诊断，返回发现的语言/语用不足（Gap 格式）。

    策略：
      1. 优先尝试调用真实 LLM（豆包 REST API）
      2. 如果 LLM 调用失败或未启用，降级使用 get_diagnosis_fallback()
    """
    logger.info(f"[diagnose_attempt] text={attempt_text[:100]}...")

    if not attempt_text.strip():
        logger.warning("[diagnose_attempt] 输入文本为空，返回空 gaps")
        return {"gaps": []}

    # 1. 尝试调用真实 LLM（文本模型）
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _DIAGNOSIS_PROMPT},
                {"role": "user", "content": attempt_text},
            ],
        }
        logger.info(f"[diagnose_attempt] 调用 LLM — model={DOUBAO_MODEL_ID}")
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()

        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        # 去除 markdown 代码块包裹
        if raw.startswith("```"):
            lines = raw.split("\n")
            lines = lines[1:] if lines[0].startswith("```") else lines
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw = "\n".join(lines)
        parsed = json.loads(raw)
        logger.info(f"[diagnose_attempt] LLM 返回 {len(parsed.get('gaps',[]))} 条 gap")
        return parsed

    except Exception as e:
        logger.warning(f"[diagnose_attempt] LLM 调用失败: {e}，降级使用 fallback")

    # 2. 降级 → fallback
    return get_diagnosis_fallback()


# ============================================================
# 3. 学习材料生成
# ============================================================
def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    logger.info(f"[input_pack] gaps={len(gaps)}")
    try:
        gap_text = "\n".join(f"- {g.get('label','')}: {g.get('explanation','')}" for g in gaps)
        raw = _call_doubao([
            {"role": "system", "content": _INPUTPACK_PROMPT},
            {"role": "user", "content": f"学生不足:\n{gap_text}\n请生成针对性学习材料。"},
        ])
        result = _parse_json(raw)
        logger.info(f"  chunks={len(result.get('scene_chunks',[]))}")
        return result
    except Exception as e:
        logger.warning(f"  LLM failed: {e}, using Mock")
        return dict(_MOCK_INPUTPACK)


# ============================================================
# 4. 练习题生成（Mock，结构稳定无需 LLM）
# ============================================================
def generate_exercises(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    logger.info(f"[exercises] gaps={len(gaps)}")
    try:
        gap_text = "\n".join(f"- [{g.get('label','')}] {g.get('explanation','')}" for g in gaps)
        raw = _call_doubao([
            {"role": "system", "content": _EXERCISES_PROMPT},
            {"role": "user", "content": f"学生不足:\n{gap_text}\n请生成2~3道针对性练习题。"},
        ], max_tokens=800)
        result = _parse_json(raw)
        logger.info(f"  exercises={len(result.get('exercises',[]))}")
        return result
    except Exception as e:
        logger.warning(f"  LLM failed: {e}, using fallback")
        return {"exercises": [
            {"id": 1, "type": "multiple_choice", "gap_target": gaps[0].get("label","") if gaps else "通用",
             "question": "请根据学习材料中的示范对话，选择最合适的回应方式。",
             "options": [{"key":"A","text":"I want this."},{"key":"B","text":"I'd like this, please."},{"key":"C","text":"Give me this."}],
             "answer": "B", "feedback": "礼貌请求应使用 'I'd like...' + 'please'。"},
        ]}


# ============================================================
# 5. 单次七维评估
# ============================================================
def evaluate_single(conversation_text: str) -> Dict[str, Any]:
    logger.info(f"[evaluate_single] text_len={len(conversation_text)}")
    if _is_empty_or_placeholder(conversation_text):
        return dict(_NO_VALID_INPUT)
    try:
        raw = _call_doubao([
            {"role": "system", "content": _SINGLE_PROMPT},
            {"role": "user", "content": conversation_text[:2000]},
        ])
        result = _parse_json(raw)
        logger.info(f"  scores={len(result.get('scores',{}))} dims")
        return result
    except Exception as e:
        logger.warning(f"  LLM failed: {e}, using Mock")
        scores = {}
        comments = {}
        for dim in ["发音标准度", "语法规范性", "词汇适配性", "语言功能达成度", "语用策略得体性", "话语回合适配性", "副语言匹配度"]:
            scores[dim] = round(2.0 + random.uniform(0, 1.5), 1)
            comments[dim] = "LLM 调用失败，当前为 Mock 降级数据。"
        scores["发音标准度"] = 2.5
        scores["副语言匹配度"] = 2.5
        return {"scores": scores, "comments": comments}


# ============================================================
# 6. 双轨对比评估
# ============================================================
def evaluate_compare(attempt1_text: str, attempt2_text: str) -> Dict[str, Any]:
    logger.info(f"[evaluate_compare] len1={len(attempt1_text)} len2={len(attempt2_text)}")
    if _is_empty_or_placeholder(attempt1_text) or _is_empty_or_placeholder(attempt2_text):
        return dict(_NO_VALID_INPUT)
    try:
        raw = _call_doubao([
            {"role": "system", "content": _COMPARE_PROMPT},
            {"role": "user", "content": f"【初次产出】\n{attempt1_text[:1500]}\n\n【二次产出】\n{attempt2_text[:1500]}"},
        ])
        data = _parse_json(raw)
        comparison = data.get("comparison", [])
        a1, a2 = {}, {}
        for c in comparison:
            a1[c["dimension"]] = c["attempt1_score"]
            a2[c["dimension"]] = c["attempt2_score"]
        logger.info(f"  comparison={len(comparison)} dims")
        return {"attempt1_scores": a1, "attempt2_scores": a2, "comparison": comparison}
    except Exception as e:
        logger.warning(f"  LLM failed: {e}, using Mock")
        dims_list = ["发音标准度", "语法规范性", "词汇适配性", "语言功能达成度", "语用策略得体性", "话语回合适配性", "副语言匹配度"]
        comments_pool = ["从初级表达到更丰富句式，进步明显。", "语法错误减少，表达更规范。",
                         "场景词汇使用更准确。", "任务完成度提高。", "礼貌表达更自然。", "话轮衔接更流畅。", "语音语调有改善。"]
        a1, a2, comp = {}, {}, []
        for i, dim in enumerate(dims_list):
            s1 = round(1.5 + random.uniform(0, 2.0), 1)
            s2 = round(min(5.0, s1 + 0.5 + random.uniform(0, 1.0)), 1)
            ch = round(s2 - s1, 1)
            a1[dim], a2[dim] = s1, s2
            comp.append({"dimension": dim, "attempt1_score": s1, "attempt2_score": s2,
                         "change": f"+{ch}" if ch >= 0 else str(ch), "comment": random.choice(comments_pool)})
        return {"attempt1_scores": a1, "attempt2_scores": a2, "comparison": comp}


# ============================================================
# 7. 靶向 Gap 改善评估
# ============================================================
def evaluate_target_gaps(attempt1_text: str, attempt2_text: str, gaps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    logger.info(f"[target_gaps] gaps={len(gaps)}")
    if not gaps:
        return []
    if not attempt2_text.strip():
        return [{"gap_label": g.get("label", "?"), "improved": False,
                 "evidence": "二次产出文本为空", "suggestion": "请完成二次产出后再评估"} for g in gaps]
    try:
        gap_lines = "\n".join(f"- [{g.get('label','')}] {g.get('explanation','')}" for g in gaps)
        raw = _call_doubao([
            {"role": "system", "content": "判断以下不足在二次产出中是否改善。返回 JSON 数组: [{\"gap_label\":\"...\",\"improved\":true,\"evidence\":\"二次产出原文证据\",\"suggestion\":\"建议\"}]"},
            {"role": "user", "content": f"不足列表:\n{gap_lines}\n\n二次产出:\n{attempt2_text[:1500]}"},
        ])
        result = _parse_json(raw)
        logger.info(f"  {len(result) if isinstance(result, list) else 0} items")
        return result if isinstance(result, list) else []
    except Exception as e:
        logger.warning(f"  LLM failed: {e}, using Mock")
        return [{"gap_label": g.get("label", "?"), "improved": random.choice([True, True, False]),
                 "evidence": "Mock 降级评估，实际评估需 LLM。", "suggestion": "建议查看逐维度分析了解更多。"} for g in gaps]


# ============================================================
# 旧接口兼容 (evaluate 别名)
# ============================================================
def evaluate(attempt1_text: str, attempt2_text: str) -> Dict[str, Any]:
    """兼容旧调用方的 evaluate 函数，内部调用 evaluate_compare。"""
    comp = evaluate_compare(attempt1_text, attempt2_text)
    dims = comp["comparison"]
    scores = {}
    for c in dims:
        scores[c["dimension"]] = {"attempt1": c["attempt1_score"], "attempt2": c["attempt2_score"]}
    return {"dimension_scores": scores,
            "problem_improved": "\n".join(f"{c['dimension']}: {c['comment']}" for c in dims),
            "full_report": "双轨评价报告\n" + "\n".join(f"[{c['dimension']}] {c['change']}: {c['comment']}" for c in dims)}
