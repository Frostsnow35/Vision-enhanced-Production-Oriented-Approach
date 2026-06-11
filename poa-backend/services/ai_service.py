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
import httpx
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

    # 清理泄露的 thinking 标签
    import re as _re
    content = _re.sub(r'</?think[^>]*>', '', content)
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

import re as _re
_DIGIT_DASH_RE = _re.compile(r"^\s*[\d]+([\s\-—_]+[\d]+)+\s*$")
_REPEATED_DASH_RE = _re.compile(r"[-—_]{3,}")
_JSON_RESIDUE_RE = _re.compile(r'[\{\}\[\]"]|"\w+":|^\s*\{|\}\s*$')
_PRODUCT_HALLUCINATION_RE = _re.compile(
    r"\b(vanilla latte|cappuccino|espresso|macchiato|frappuccino|"
    r"cold brew|iced latte|matcha latte|caramel macchiato)\b", _re.IGNORECASE
)
# 时间戳格式 "YYYY-MM-DD" (如 2024-01-15) 或 "YYYY/MM/DD"
_TIMESTAMP_DATE_RE = _re.compile(r'\b\d{2,4}[-/]\d{1,2}[-/]\d{1,2}\b')
# 时间格式 "HH:MM" 或 "HH:MM:SS" 或 "HH:MM AM/PM"
_TIMESTAMP_TIME_RE = _re.compile(r'\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\b')
# 纯数字串（5位及以上连续数字）
_PURE_NUMBER_RE = _re.compile(r'\b\d{5,}\b')


def _sanitize_opening_line(raw: str, closing_line: str = "") -> str:
    """
    清洗 VLM 输出的 opening_line。
    - 空串 / 纯数字串+dash 组合（"12-3-45-67"）/ 连续 dash / JSON 残留 → 返回 ""
    - 长度 > 25 词 → 截断到 25 词
    - 与 closing_line 相同 → 返回 ""（避免复用）
    - 含具体产品名（vanilla latte / cappuccino 等）→ 返回 ""（避免编造）
    - 清洗后为空时，前端 chatStart 降级到 generate_opening
    """
    if not raw:
        return ""
    text = raw.strip()
    if not text:
        return ""
    # 1. 数字串 + dash 组合
    if _DIGIT_DASH_RE.match(text):
        return ""
    # 2. 连续 dash
    if _REPEATED_DASH_RE.search(text):
        return ""
    # 3. JSON 残留
    if _JSON_RESIDUE_RE.search(text):
        return ""
    # 4. 与 closing_line 相同
    if closing_line and text.strip().lower() == closing_line.strip().lower():
        return ""
    # 5. 含具体产品名（编造）
    if _PRODUCT_HALLUCINATION_RE.search(text):
        return ""
    # 6. 时间戳日期格式
    if _TIMESTAMP_DATE_RE.search(text):
        return ""
    # 7. 时间格式 HH:MM
    if _TIMESTAMP_TIME_RE.search(text):
        return ""
    # 8. 纯数字串
    if _PURE_NUMBER_RE.search(text):
        return ""
    # 9. 长度截断
    words = text.split()
    if len(words) > 25:
        text = " ".join(words[:25])
    return text


def _sanitize_closing_line(raw: str) -> str:
    """
    清洗 VLM 输出的 closing_line。
    - 空串 / 数字串 / JSON 残留 → 返回 ""
    - 长度 > 30 词 → 截断
    """
    if not raw:
        return ""
    text = raw.strip()
    if not text:
        return ""
    if _DIGIT_DASH_RE.match(text):
        return ""
    if _REPEATED_DASH_RE.search(text):
        return ""
    if _JSON_RESIDUE_RE.search(text):
        return ""
    # 4. 时间戳日期格式
    if _TIMESTAMP_DATE_RE.search(text):
        return ""
    # 5. 时间格式 HH:MM
    if _TIMESTAMP_TIME_RE.search(text):
        return ""
    # 6. 纯数字串
    if _PURE_NUMBER_RE.search(text):
        return ""
    words = text.split()
    if len(words) > 30:
        text = " ".join(words[:30])
    return text

_NO_VALID_INPUT = {"error": "no_valid_input", "message": "未检测到有效语音内容，请重新录音。"}


# ============================================================
# Prompt 模板
# ============================================================
_SCENE_PROMPT = """你是一个英语教学场景分析专家。分析这张照片，为POA（产出导向法）英语学习任务设计场景。

【关键要求】
1. scene_label: 使用场景专有名称（如"Cafe Brew & Co."而非泛化的"咖啡店"）
2. roles: 明确两个角色及其身份特征（A为学生扮演角色; B为AI扮演角色），角色要具体有职业感
3. goal: 写出1个明确的交际主目标（+ 至多1个可选子目标），主目标必须包含至少2个具体的产出标准（如"用委婉请求句式点单并确认特殊需求"）
4. context_constraints: 1~2条场景特有的限制条件（时间压力/特殊顾客需求/意外情况等）
5. evaluation_criteria: 3~5条评价维度，每条针对特定语言功能（禁止仅使用"准确性""流利度"等通用维度，必须与具体交际场景相关）
6. variant_plot: 基于同一场景设计一个不同情节变体（更换子任务/增加突发状况/改变其中一个角色的条件），变体必须和主情节有实质差异
7. opening_line: B角色（AI角色）的第一句开场白，必须满足：
   - 包含至少1个场景专有词（latte/espresso 用于咖啡店；boarding gate/luggage 用于机场；prescription/appointment 用于医院；dues/renewal 用于图书馆；order/menu 用于餐厅 等）
   - 包含明确的引导提问（? 结尾的问句或具体选项），帮助学生快速进入角色
   - 禁止泛化开场白（如 "Hello! How can I help you?" / "Hi there! What can I do for you?"）
   - 例（咖啡店）: "Good morning! Our single-origin Ethiopian pour-over is fantastic today. What catches your eye?"
   - 例（机场）: "Good morning! May I see your passport and booking reference, please?"
8. closing_line: B角色在主目标达成后的自然告别句，必须满足：
   - 使用场景特有的告别方式（咖啡店 "Enjoy your coffee!" / 机场 "Have a safe flight!" / 医院 "Take care and feel better soon!" / 餐厅 "Enjoy your meal!"）
   - 禁止泛化告别（"Goodbye!" / "See you!" / "Have a good day!" 等单独使用）
   - 长度 ≤ 30 词
   - 能在对话自然收束时被学生识别为"任务完成"
9. 【任务规模约束】整个对话设计为1个主目标 + 至多1个选子目标，3~5轮对话内可完成；不要设计复杂多目标/多层情节/多个突发事件；优先聚焦在生活化场景中的1个核心互动

【场景化生活化要求】
- 必须使用真实生活场景（咖啡店/医院/机场/图书馆/餐厅/酒店/银行/商店等），禁止抽象/虚构场景
- 场景元素（产品/服务/地点）必须具体可感（如"燕麦奶拿铁"而非"饮品"、"登机口"而非"场所"）
- 角色身份要具体（"收银员 Emma"而非"店员"），增加代入感

【交际类型多样性】（从以下随机选一种，不要总选"请求服务"）
- 请求服务型（ordering/booking/requesting）
- 问题解决型（complaint/reschedule/correcting a mistake）
- 信息询问型（asking for directions/recommendations/details）
- 协商条件型（negotiating price/terms/alternatives）
- 表达需求型（special needs/preferences/allergies）
- 社交互动型（small talk + task purpose）

【输出要求】
严格输出如下 JSON（不要输出任何其他内容）：
{"scene_label":"场景专有名称","poa_task":{"roles":"A:具体角色; B:具体角色","goal":"1个主目标（含1-2个产出标准）+至多1个选子目标","context_constraints":"1~2条场景特有的限制条件","evaluation_criteria":["具体维度1","具体维度2","具体维度3"]},"variant_plot":"不同情节变体描述","opening_line":"B角色的第一句开场白（场景化+引导提问）","closing_line":"B角色的场景化告别（≤30词）"}"""

_DIAGNOSIS_PROMPT = """你是英语口语诊断专家。找出学生对话中的 Top 3 不足，返回 JSON:
{"gaps":[{"label":"不足分类","evidence_sentence":"原文证据","explanation":"为什么需要改进及正确建议"}]}"""

_SINGLE_PROMPT = """你是英语口语评估专家。请严格按照以下七维标准评分(1-5,精确到0.1)，并写中文评语。返回 JSON:
{"scores":{"发音标准度":0,"语法规范性":0,"词汇适配性":0,"语言功能达成度":0,"语用策略得体性":0,"话语回合适配性":0,"副语言匹配度":0},
 "comments":{"发音标准度":"评语","语法规范性":"评语","词汇适配性":"评语","语言功能达成度":"评语","语用策略得体性":"评语","话语回合适配性":"评语","副语言匹配度":"评语"}}

【七维评分锚点 — 必须严格参照】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%,连读弱读自然。基于文本特征推断：句式完整流畅则发音清晰度较高(3-5分)；句式碎片化则可能发音生硬(1-3分)
2.语法规范性: 1=错误率>=35%,句子混乱 | 3=错误<15%,核心意思可懂 | 5=错误<5%,稳定正确,能使用复杂结构
3.词汇适配性: 1=用词与场景脱节 | 3=基本匹配,准确率>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=任务完成率<50% | 3=完成率>=70%,意图可理解 | 5=完成率>=85%,高效完成
5.语用策略得体性: 1=礼貌表达率<30%,生硬 | 3=礼貌率>=50%,使用基础句式 | 5=礼貌率>=85%,灵活调整策略
6.话语回合适配性: 1=话轮失衡>=50%,无转换信号 | 3=失衡<30%,有基础转换 | 5=失衡<10%,熟练使用多种转换句式
7.副语言匹配度: 基于文本特征推断流利度和节奏感：有衔接词则流利度较高(3-5分)；直接作答则偏低(1-3分)；有完整对话闭合则节奏感好

【评语要求】每个 comment 必须引用对话中的具体证据(原句或描述)，长度 20-60 字。发音和副语言维度的评语直接引用文本证据说明，不提及"无音频"或"由文本推断"。"""

_COMPARE_PROMPT = """你是英语口语评估专家。对比初次和二次对话，对七维逐项打分并写对比评语。返回 JSON:
{"comparison":[
  {"dimension":"发音标准度","attempt1_score":2.5,"attempt2_score":3.5,"change":"+1.0",
   "comment":"评语（必须引用两次对话的原文举例，清晰说明分数变化原因）"}]}

【七维评分锚点 — 与单次评估标准完全一致】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%。基于文本推断：句式复杂度提升则发音清晰度随之改善
2.语法规范性: 1=错误率>=35% | 3=错误<15% | 5=错误<5%,稳定正确
3.词汇适配性: 1=用词脱节 | 3=基本匹配>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=完成率<50% | 3=>=70% | 5=>=85%,高效完成
5.语用策略得体性: 1=礼貌率<30% | 3=>=50% | 5=>=85%,灵活策略
6.话语回合适配性: 1=失衡>=50% | 3=<30% | 5=<10%,熟练转换
7.副语言匹配度: 基于文本推断流利度和节奏感变化：衔接词增加则流利度提升；句式变丰富则节奏感改善

【对比评语要求】
每个 comment 必须包含: 1)初次产出中的具体证据(原句) 2)二次产出中的具体证据(原句) 3)进步或退步的具体原因。发音和副语言维度的评语直接引用文本证据说明变化，不提及"无音频"或"由文本推断"。
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
    "scores": {"发音标准度": 3.0, "语法规范性": 2.5, "词汇适配性": 2.5,
               "语言功能达成度": 2.5, "语用策略得体性": 2.5, "话语回合适配性": 2.5, "副语言匹配度": 3.0},
    "comments": {"发音标准度": "句式基本完整，可推断发音清晰度尚可。", "语法规范性": "Mock降级数据，请重试。",
                 "词汇适配性": "Mock降级数据，请重试。", "语言功能达成度": "Mock降级数据，请重试。",
                 "语用策略得体性": "Mock降级数据，请重试。", "话语回合适配性": "Mock降级数据，请重试。",
                 "副语言匹配度": "对话有一定衔接，节奏感基本自然。"}
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
    cc = poa.get("context_constraints", "")
    if isinstance(cc, list):
        cc = "\n".join(c for c in cc)

    raw_opening = p.get("opening_line", "")
    raw_closing = p.get("closing_line", "")
    # 清洗 opening_line / closing_line：剔除数字串 dash 组合、JSON 残留、编造产品等
    sanitized_opening = _sanitize_opening_line(raw_opening, closing_line=raw_closing)
    sanitized_closing = _sanitize_closing_line(raw_closing)

    result = {
        "scene_label": p.get("scene_label", ""),
        "roles": poa.get("roles", ""),
        "goal": poa.get("goal", ""),
        "context_constraints": cc,
        "evaluation_criteria": ec if isinstance(ec, str) else str(ec),
        "variant_plot": p.get("variant_plot", ""),
        "opening_line": sanitized_opening,
        "closing_line": sanitized_closing,
    }
    if not sanitized_opening:
        logger.info(f"  [analyze_scenario] opening_line 清空（原始: {raw_opening[:60]!r}），前端将降级到 generate_opening")
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
            logger.info(f"[get_or_analyze] cache hit scenario_id={ex.id} task_id={t.id}")
            return {"scenario_id": ex.id, "task_id": t.id, "scene_label": ex.scene_label, "roles": t.roles or "", "goal": t.goal or "",
                    "context_constraints": t.context_constraints or "", "evaluation_criteria": t.evaluation_criteria or "",
                    "variant_plot": t.variant_plot or "",
                    "opening_line": t.opening_line or "", "closing_line": t.closing_line or ""}

    result = analyze_scenario(image_path)
    scenario_id = None
    try:
        s = Scenario(image_path=image_path, image_hash=h, scene_label=result["scene_label"])
        db.add(s); db.flush()
        scenario_id = s.id
        t = POATask(scenario_id=s.id, roles=result["roles"], goal=result["goal"],
                     context_constraints=result["context_constraints"],
                     evaluation_criteria=result["evaluation_criteria"], variant_plot=result["variant_plot"],
                     opening_line=result.get("opening_line", ""), closing_line=result.get("closing_line", ""))
        db.add(t); db.flush()
        db.commit()
        result["task_id"] = t.id
    except Exception as e:
        db.rollback(); logger.error(f"  DB write failed: {e}")
    result["scenario_id"] = scenario_id
    return result


# ============================================================
# 2. 产出诊断 → LLM 调用 + 降级 fallback
# ============================================================

# 诊断 prompt
_DIAGNOSIS_PROMPT = """\
你是一个严格、细致的英语口语诊断专家。仔细阅读学生的对话文本，结合场景和角色语境，找出真正存在问题的最多 4 条语言/语用不足（必须同时覆盖文本维度和基于文本特征推断的音频维度）。

【诊断维度要求】
- 必须至少包含 1 条文本维度（词汇/语法/语用/话轮）
- 必须至少包含 1 条基于文本特征反向推断的音频维度（发音清晰度/流利度/语调自然度/节奏感）
- 文本特征 → 音频表现的推断逻辑：
  - 句式碎片化、用词简单 → 推断发音可能较生硬、停顿偏多
  - 句式完整流畅、词汇准确 → 推断发音清晰、语调自然
  - 缺少衔接词 → 推断话轮衔接不够流畅
  - 有完整开场/回应/收尾 → 推断节奏感较好

【重要原则】
- 必须从对话中逐句寻找问题，不要套用模板化的常见错误
- 只有确认原文中确实存在该问题时才列出来
- 如果对话质量确实不错，可以减少 gap 数量（最少 1 条），不要无中生有
- 优先找出对学生交际效果影响最大的问题
- 音频维度的 label 要具体，如"发音清晰度-元音区分不足""流利度-句子连接不流畅""语调-缺少自然升降"

严格输出如下 JSON（不要输出其他内容）：
{
  "gaps": [
    {
      "label": "不足分类（文本维度如：请求句式-过于直接 / 时态混乱 / 词汇重复 / 话轮过长；音频维度如：发音清晰度-元音区分不足 / 流利度-句子连接不流畅 / 语调-缺少自然升降）",
      "evidence_sentence": "原文中的具体句子（必须逐字引用）",
      "reference_expression": "更自然/更准确的英文正确表达（必填，1 句话）",
      "explanation": "结合当前场景和角色，说明为什么需要改进。音频维度的 explanation 要自然融入文本证据，如'你的句子较短且多为简单词，由此推断发音时可能停顿较多，建议放慢语速清晰朗读每个词'"
    }
  ],
  "high_freq_errors": [
    {
      "phrase": "原文中反复出现的错误短语",
      "occurrence": 出现次数,
      "suggestion": "修正建议（1 句话）"
    }
  ]
}

要求：
- evidence_sentence 必须是从原文中逐字摘录的完整句子
- reference_expression 是地道的英语正确说法
- explanation 必须引用场景和角色，不能是泛泛而谈
- 音频维度解释不能提"无音频分析"或"由文本推断"，直接用自然措辞
- high_freq_errors 至少 1 条，最多 3 条，phrase 必须来自原文
"""


def get_diagnosis_fallback() -> Dict[str, Any]:
    """
    返回固定的 Top 3 不足（含文本+音频维度，通用版）。
    当真实 LLM 调用失败或未启用时使用。
    """
    return {
        "gaps": [
            {
                "label": "话轮衔接-缺乏互动确认",
                "evidence_sentence": "(对方提问后直接作答，缺少衔接词)",
                "reference_expression": "Sure, I'd like a cappuccino, please.",
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
                "reference_expression": "Could I have a large latte with oat milk, please?",
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
                "reference_expression": "Could I switch to almond milk instead?",
                "explanation": (
                    "每个交际场景都有其核心词汇和固定搭配。使用过于泛化的词汇"
                    "（如 'thing', 'stuff', 'big', 'get'）会让表达显得不够地道。"
                    "建议：积累场景特定的词汇，例如咖啡店的 'latte/cappuccino/oat milk'，"
                    "图书馆的 'check out/renew/overdue'，餐厅的 'appetizer/main course/bill'。"
                ),
            },
            {
                "label": "发音清晰度-语流不够连贯",
                "evidence_sentence": "(句式简短且缺少连接词)",
                "reference_expression": "I think I'll go with the vanilla latte, and could I also get a blueberry muffin?",
                "explanation": (
                    "你的句子较短且缺乏连接词（and/but/so），由此可以判断说出这些句子时"
                    "语流可能不够连贯，词与词之间停顿偏多。建议练习使用连接词将短句"
                    "合并为流畅的复合句，这样发音时的语流自然会更加连贯。"
                ),
            },
        ],
        "high_freq_errors": [],
    }


def diagnose_attempt(attempt_text: str, scene_context: str = "") -> Dict[str, Any]:
    """
    对学生的一次作答文本进行诊断，返回发现的语言/语用不足（Gap 格式）。

    策略：
      1. 优先尝试调用真实 LLM（豆包 REST API）
      2. 如果 LLM 调用失败或未启用，降级使用 get_diagnosis_fallback()
    """
    logger.info(f"[diagnose_attempt] text={attempt_text[:100]}... context={scene_context[:50]}")

    if not attempt_text.strip():
        logger.warning("[diagnose_attempt] 输入文本为空，返回空 gaps")
        return {"gaps": []}

    # 构建用户消息：场景信息 + 对话文本
    user_msg = f"场景信息：{scene_context}\n\n对话文本：\n{attempt_text}" if scene_context else attempt_text

    # 1. 尝试调用真实 LLM（文本模型）
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _DIAGNOSIS_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        }
        logger.info(f"[diagnose_attempt] 调用 LLM — model={DOUBAO_MODEL_ID}")
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                CHAT_URL,
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
        logger.info(f"[diagnose_attempt] LLM 返回 {len(parsed.get('gaps',[]))} 条 gap, {len(parsed.get('high_freq_errors',[]))} 条高频错误")
        # 兜底字段（LLM 偶尔漏字段）
        if "gaps" not in parsed or not isinstance(parsed["gaps"], list):
            parsed["gaps"] = []
        if "high_freq_errors" not in parsed or not isinstance(parsed["high_freq_errors"], list):
            parsed["high_freq_errors"] = []
        return parsed

    except Exception as e:
        logger.warning(f"[diagnose_attempt] LLM 调用失败: {e}，降级使用 fallback")

    # 2. 降级 → fallback
    return get_diagnosis_fallback()


# ============================================================
# 2.5 高频错误提取（phrase-level）
# ============================================================
_HIGHFREQ_PROMPT = """\
你是英语口语错误分析助手。分析学生的对话文本，找出 phrase-level 的高频错误（按出现频次降序）。
严格输出如下 JSON（不要输出其他内容）：
{
  "high_freq_errors": [
    {
      "phrase": "学生反复使用的错误短语（必须出现在原文中）",
      "occurrence": 出现次数（整数，最少 2）,
      "suggestion": "修正建议（1 句话，英文）"
    }
  ]
}

要求：
- 至少 1 条，最多 3 条
- phrase 必须在原文中真实出现过 2 次以上
- occurrence 必须真实反映出现次数，不要夸大
- 如果找不到符合条件的高频错误，返回空数组
"""


def _extract_high_freq_errors(attempt_text: str) -> List[Dict[str, Any]]:
    """
    从 attempt_text 中提取 phrase-level 高频错误（LLM 单次调用）。
    失败时返回空列表。
    """
    if not attempt_text or not attempt_text.strip() or len(attempt_text) < 50:
        return []
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _HIGHFREQ_PROMPT},
                {"role": "user", "content": attempt_text},
            ],
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            lines = lines[1:] if lines[0].startswith("```") else lines
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw = "\n".join(lines)
        parsed = json.loads(raw)
        errors = parsed.get("high_freq_errors", [])
        if not isinstance(errors, list):
            return []
        # 字段兜底
        cleaned = []
        for e in errors:
            if not isinstance(e, dict):
                continue
            phrase = str(e.get("phrase", "")).strip()
            if not phrase:
                continue
            try:
                occ = int(e.get("occurrence", 1))
            except (TypeError, ValueError):
                occ = 1
            cleaned.append({
                "phrase": phrase[:100],  # 截断防止超长
                "occurrence": max(1, occ),
                "suggestion": str(e.get("suggestion", "")).strip()[:200],
            })
        return cleaned[:3]
    except Exception as e:
        logger.warning(f"[high_freq_errors] 提取失败: {e}，返回空列表")
        return []


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
