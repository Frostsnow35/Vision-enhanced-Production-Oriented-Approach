"""
促成学习服务 —— LLM 根据诊断 Gap 动态生成精准学习材料。
"""
import json
import logging
import time
import re
from typing import Any, Dict, List

import requests

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("facilitate_service")

CHAT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
_TIMEOUT = 60
_MAX_TOKENS = 1500


# ---- 场景类型检测 + 场景相关 Mock 数据 ----

def _detect_scene_type(scene_label: str, roles: str, goal: str) -> str:
    """根据场景标签/角色/目标推断场景类型"""
    text = f"{scene_label} {roles} {goal}".lower()
    if re.search(r"咖啡|cafe|coffee|latte|espresso|cappuccino", text):
        return "coffee"
    if re.search(r"机场|airport|flight|boarding|check.?in|航站|值机|登机", text):
        return "airport"
    if re.search(r"餐厅|restaurant|点餐|订餐|menu|waiter", text):
        return "restaurant"
    if re.search(r"图书馆|library|借书|还书|book", text):
        return "library"
    if re.search(r"医院|hospital|doctor|clinic|症状|prescription", text):
        return "hospital"
    if re.search(r"商场|mall|shop|store|衣服|试穿", text):
        return "mall"
    return "generic"


# 各场景的 Mock 词块
SCENE_PHRASES: Dict[str, List[Dict[str, str]]] = {
    "coffee": [
        {"function": "礼貌请求", "sentence": "I'd like a large latte, please."},
        {"function": "委婉询问", "sentence": "Could I have that with oat milk instead?"},
        {"function": "确认信息", "sentence": "So that's a medium iced latte — correct?"},
        {"function": "回应提议", "sentence": "Yes, for here, please. / To go, thanks."},
        {"function": "表达感谢", "sentence": "Thank you so much! Have a great day!"},
        {"function": "请求重复", "sentence": "Sorry, could you say that again?"},
    ],
    "airport": [
        {"function": "表达需求", "sentence": "I'd like to check in for my flight to New York, please."},
        {"function": "询问信息", "sentence": "Could you tell me which gate I should go to?"},
        {"function": "确认信息", "sentence": "So my gate is B12 and boarding starts at 3 PM, correct?"},
        {"function": "表达担忧", "sentence": "I'm worried my bag might be overweight. What is the limit?"},
        {"function": "请求帮助", "sentence": "Could you help me find the check-in counter for China Eastern?"},
        {"function": "表达感谢", "sentence": "Thank you for your help. Have a great day!"},
    ],
    "restaurant": [
        {"function": "礼貌请求", "sentence": "We'd like to order, please."},
        {"function": "委婉询问", "sentence": "Could I see the menu, please?"},
        {"function": "表达偏好", "sentence": "I'd like the grilled salmon with a side of vegetables."},
        {"function": "确认信息", "sentence": "So that's one grilled salmon and one mushroom soup — correct?"},
        {"function": "表达感谢", "sentence": "Thank you very much! The food was excellent!"},
        {"function": "请求帮助", "sentence": "Could I have the bill, please?"},
    ],
    "library": [
        {"function": "礼貌请求", "sentence": "Excuse me, could you help me find books on British literature?"},
        {"function": "询问信息", "sentence": "How long can I borrow a book for?"},
        {"function": "表达需求", "sentence": "I'd like to borrow this book. Could you check it out for me?"},
        {"function": "确认信息", "sentence": "So I need to return these by next Friday?"},
        {"function": "表达感谢", "sentence": "Thank you so much for your help!"},
        {"function": "请求帮助", "sentence": "Could you show me how to use the self-checkout machine?"},
    ],
    "hospital": [
        {"function": "描述症状", "sentence": "I've had a severe headache and fever since yesterday."},
        {"function": "礼貌请求", "sentence": "I'd like to make an appointment with Dr. Wang, please."},
        {"function": "询问信息", "sentence": "Could you tell me what time the clinic opens?"},
        {"function": "确认信息", "sentence": "So I should take this medicine three times a day after meals?"},
        {"function": "表达感谢", "sentence": "Thank you, doctor. I really appreciate your help."},
        {"function": "请求重复", "sentence": "Sorry, could you explain that again more slowly?"},
    ],
    "mall": [
        {"function": "礼貌请求", "sentence": "Excuse me, do you have this shirt in a medium size?"},
        {"function": "询问信息", "sentence": "Could you tell me where the fitting rooms are?"},
        {"function": "表达偏好", "sentence": "I'm looking for something a bit more formal, in blue."},
        {"function": "确认信息", "sentence": "So this is on sale for 30% off — that's great!"},
        {"function": "表达感谢", "sentence": "Thank you for your help! I'll take it."},
        {"function": "请求帮助", "sentence": "Could you gift-wrap this for me, please?"},
    ],
    "generic": [
        {"function": "礼貌请求", "sentence": "I'd like some help with this, please."},
        {"function": "委婉询问", "sentence": "Could you tell me more about that?"},
        {"function": "确认信息", "sentence": "So that's everything, correct?"},
        {"function": "表达感谢", "sentence": "Thank you so much for your help!"},
        {"function": "请求重复", "sentence": "Sorry, could you say that again?"},
        {"function": "礼貌告别", "sentence": "Thank you. Have a great day!"},
    ],
}

# 各场景的 Mock 示范对话
SCENE_DIALOGUES: Dict[str, Dict[str, Any]] = {
    "coffee": {
        "title": "咖啡店点单 — 示范对话",
        "lines": [
            {"speaker": "Barista", "text": "Hi there! What can I get for you today?"},
            {"speaker": "Customer", "text": "Hi! I'd like a medium iced latte, please."},
            {"speaker": "Barista", "text": "Sure. For here or to go?"},
            {"speaker": "Customer", "text": "For here, thanks."},
            {"speaker": "Barista", "text": "Anything else?"},
            {"speaker": "Customer", "text": "Actually, could I have that with oat milk?"},
            {"speaker": "Barista", "text": "Of course! That'll be $5.50."},
            {"speaker": "Customer", "text": "Great, here's my card. Thank you!"},
        ],
    },
    "airport": {
        "title": "机场值机 — 示范对话",
        "lines": [
            {"speaker": "Staff", "text": "Good morning! Welcome to the check-in counter. May I have your passport and booking reference?"},
            {"speaker": "Passenger", "text": "Good morning! Yes, here they are. I'd like a window seat if possible."},
            {"speaker": "Staff", "text": "Certainly. You're checked in for Flight CA123 to Beijing. Do you have any luggage to check?"},
            {"speaker": "Passenger", "text": "Yes, I have one suitcase. Is it within the weight limit?"},
            {"speaker": "Staff", "text": "Let me put it on the scale... It's 18 kilograms. The limit is 23, so you're fine."},
            {"speaker": "Passenger", "text": "Great, thank you! Could you tell me which gate I should go to?"},
            {"speaker": "Staff", "text": "Your gate is B12. Boarding starts at 2:40 PM."},
            {"speaker": "Passenger", "text": "Thank you so much for your help!"},
        ],
    },
    "restaurant": {
        "title": "餐厅点餐 — 示范对话",
        "lines": [
            {"speaker": "Waiter", "text": "Good evening! Welcome. Do you have a reservation?"},
            {"speaker": "Guest", "text": "Yes, under the name Chen."},
            {"speaker": "Waiter", "text": "Yes, here we are. Here's your menu. Would you like to start with some drinks?"},
            {"speaker": "Guest", "text": "Could I see the wine list, please?"},
            {"speaker": "Waiter", "text": "Of course. Are you ready to order, or do you need a few more minutes?"},
            {"speaker": "Guest", "text": "I'd like the grilled salmon with vegetables, please."},
            {"speaker": "Waiter", "text": "Excellent choice. How would you like your salmon cooked?"},
            {"speaker": "Guest", "text": "Medium, please. Thank you."},
        ],
    },
    "generic": {
        "title": "场景示范对话",
        "lines": [
            {"speaker": "A", "text": "Hello! How can I help you today?"},
            {"speaker": "B", "text": "Hello! I'd like some help with this, please."},
            {"speaker": "A", "text": "Of course. What do you need?"},
            {"speaker": "B", "text": "Could you tell me more about this?"},
            {"speaker": "A", "text": "Certainly. Let me explain."},
            {"speaker": "B", "text": "Thank you so much for your help!"},
        ],
    },
}

# 各场景的 Mock 练习
SCENE_EXERCISES: Dict[str, List[Dict[str, Any]]] = {
    "coffee": [
        {
            "id": 1,
            "context": "你走进一家咖啡店，想点一杯大杯冰拿铁并把牛奶换成燕麦奶。你应该怎么说？",
            "options": [
                {"key": "A", "text": "I want a large iced latte. No milk."},
                {"key": "B", "text": "I'd like a large iced latte with oat milk, please."},
                {"key": "C", "text": "Give me a large latte with oat milk."},
            ],
            "answer": "B",
            "explanation": "B 使用 'I'd like...' + 'please'，是最礼貌得体的表达。",
        },
        {
            "id": 2,
            "context": "咖啡师问 'For here or to go?'，你想在这里喝。以下哪种回应最自然？",
            "options": [
                {"key": "A", "text": "Here."},
                {"key": "B", "text": "I'll stay here."},
                {"key": "C", "text": "For here, please."},
            ],
            "answer": "C",
            "explanation": "C 重复关键词 'for here' 表示确认，并加上 'please' 保持礼貌。",
        },
        {
            "id": 3,
            "context": "你没听清咖啡师说的话，想请对方重复一遍。你应该怎么说？",
            "options": [
                {"key": "A", "text": "What?"},
                {"key": "B", "text": "Can you say it again?"},
                {"key": "C", "text": "Sorry, could you say that again, please?"},
            ],
            "answer": "C",
            "explanation": "C 用 'Sorry' 开头表达歉意，用 'Could' 表示礼貌请求。",
        },
    ],
    "airport": [
        {
            "id": 1,
            "context": "你到达机场值机柜台，想办理登机手续并要一个靠窗座位。你应该怎么说？",
            "options": [
                {"key": "A", "text": "I want to check in."},
                {"key": "B", "text": "I'd like to check in, please. Could I have a window seat?"},
                {"key": "C", "text": "Check in, window seat."},
            ],
            "answer": "B",
            "explanation": "B 使用完整句式 'I'd like...' + 'Could I have...' 表达需求，既礼貌又清晰。",
        },
        {
            "id": 2,
            "context": "工作人员问你有几件行李要托运，你有一件行李箱。以下哪种回应最自然？",
            "options": [
                {"key": "A", "text": "One."},
                {"key": "B", "text": "I have one suitcase to check."},
                {"key": "C", "text": "Just one bag."},
            ],
            "answer": "B",
            "explanation": "B 给出完整信息 'I have one suitcase to check'，表达清晰且礼貌。",
        },
        {
            "id": 3,
            "context": "你担心行李超重，想询问重量限制。你应该怎么说？",
            "options": [
                {"key": "A", "text": "Is my bag too heavy?"},
                {"key": "B", "text": "Could you tell me what the weight limit is for checked luggage?"},
                {"key": "C", "text": "How heavy can bags be?"},
            ],
            "answer": "B",
            "explanation": "B 使用礼貌句式 'Could you tell me...'，在正式场合最得体。",
        },
    ],
    "generic": [
        {
            "id": 1,
            "context": "你需要帮助，想礼貌地向对方提问。你应该怎么说？",
            "options": [
                {"key": "A", "text": "Help!"},
                {"key": "B", "text": "Could you help me with this, please?"},
                {"key": "C", "text": "I need help."},
            ],
            "answer": "B",
            "explanation": "B 使用礼貌请求句式 'Could you...please?'，是最恰当的表达方式。",
        },
        {
            "id": 2,
            "context": "你没有听清对方说的话，想请对方重复。你应该怎么说？",
            "options": [
                {"key": "A", "text": "What?"},
                {"key": "B", "text": "Sorry, could you say that again?"},
                {"key": "C", "text": "Repeat."},
            ],
            "answer": "B",
            "explanation": "B 用 'Sorry' 表达歉意，用 'Could' 礼貌请求重复。",
        },
        {
            "id": 3,
            "context": "你想向对方表达感谢。你应该怎么说？",
            "options": [
                {"key": "A", "text": "Thanks."},
                {"key": "B", "text": "Thank you so much for your help!"},
                {"key": "C", "text": "Ok."},
            ],
            "answer": "B",
            "explanation": "B 加上 'so much' 和具体原因 'for your help'，表达更真诚有礼。",
        },
    ],
}


def _call_llm(messages: List[Dict[str, Any]], max_tokens: int = _MAX_TOKENS) -> str:
    body = {"model": DOUBAO_MODEL_ID, "messages": messages, "max_tokens": max_tokens}
    resp = requests.post(
        CHAT_URL,
        headers={"Authorization": f"Bearer {DOUBAO_API_KEY}", "Content-Type": "application/json"},
        json=body,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def generate_materials(
    gaps: List[Dict[str, Any]],
    scene_label: str = "",
    roles: str = "",
    goal: str = "",
) -> Dict[str, Any]:
    """
    根据诊断 Gap 和场景上下文生成：
    - phrases: 场景词块与句式
    - dialogue: 示范对话
    - exercises: 即时练习（2~3题）
    """

    scene_type = _detect_scene_type(scene_label, roles, goal)
    logger.info(f"[facilitate] 场景类型: {scene_type} (label={scene_label})")

    if not gaps:
        raise ValueError("没有 Gap 数据，无法生成促成学习材料")

    gap_descriptions = []
    for g in gaps:
        label = g.get("label") or g.get("gap_label", "")
        evidence = g.get("evidence_sentence", "")
        explanation = g.get("explanation", "")
        gap_descriptions.append(f"- {label}: {explanation} (证据: {evidence})")

    gaps_text = "\n".join(gap_descriptions)
    scene_text = f"场景: {scene_label or '未知'}, 角色: {roles or '未知'}, 目标: {goal or '未知'}"

    system_prompt = """\
你是一个英语口语教学专家。根据学生的诊断短板和给定的场景上下文，生成精准的促成学习材料。

【场景锁定 —— 最高优先级，违反即失败】
你生成的所有内容（词块、对话、练习）必须严格属于当前场景的领域。
- 绝对禁止出现与本场景无关的内容。例如：场景是书画店，绝对禁止出现餐厅点餐、机场值机、医院挂号等内容。
- 所有 phrases 的例句必须使用场景特定词汇（书画店：scroll/painting/calligraphy/brush/ink；咖啡店：latte/espresso/oat milk；机场：boarding pass/luggage/gate 等）。
- dialogue 的台词必须反映该场景的实际交互流程，speaker 名称用场景角色名（如「顾客」和「店员」，而非泛化的「A/B」）。
- exercises 的语境必须设在该场景中，选项内容与场景领域相关。

输出严格 JSON 格式，不要 markdown 代码块标记，不要多余文字。

JSON 结构:
{
  "phrases": [
    {"function": "语言功能标签(中文)", "sentence": "英语例句"},
    ...  (4~8个词块/句式)
  ],
  "dialogue": {
    "title": "示范对话标题",
    "lines": [
      {"speaker": "角色名", "text": "英语对话"},
      ...  (6~10轮对话)
    ]
  },
  "exercises": [
    {
      "id": 1,
      "gap_target": "该题针对的不足标签(必须对应上面诊断短板中的一个 label，原样引用)",
      "context": "语境描述(中文，必须基于当前场景)",
      "options": [
        {"key": "A", "text": "选项文本(英语)"},
        {"key": "B", "text": "选项文本(英语)"},
        {"key": "C", "text": "选项文本(英语)"},
        {"key": "D", "text": "选项文本(英语)"}
      ],
      "answer": "正确答案的key (A/B/C/D)",
      "explanation": "解释为什么这个选项最好(中文)"
    },
    ...  (2~3道题)
  ]
}

要求:
1. phrases 必须针对学生的诊断短板，覆盖薄弱语言功能
2. dialogue 必须严格贴合给定场景，台词自然地道，speaker 用场景角色名
3. exercises 的每个问题必须与一个 Gap 对应，并填写 gap_target 为该 Gap 的 label
4. 所有英语内容必须语法正确、语用得体
5. 直接输出 JSON，不要任何说明文字"""

    user_prompt = (
        f"【场景上下文 —— 所有生成内容必须严格限定在此场景内】\n{scene_text}\n\n"
        f"学生的诊断短板:\n{gaps_text}\n\n"
        "请生成精准的促成学习材料。记住：词块例句、对话角色、练习语境都必须属于上述场景，禁止出现任何其他场景的内容。"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    for attempt in range(2):
        try:
            t0 = time.time()
            raw = _call_llm(messages, _MAX_TOKENS)
            duration = time.time() - t0
            logger.info(f"[LLM] 尝试 {attempt + 1} 成功, dur={duration:.2f}s")

            raw = raw.strip()
            if raw.startswith("```"):
                lines = raw.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                raw = "\n".join(lines)

            result = json.loads(raw)

            phrases = result.get("phrases")
            dialogue = result.get("dialogue")
            exercises = result.get("exercises")

            if isinstance(phrases, list) and isinstance(dialogue, dict) and isinstance(exercises, list):
                logger.info(f"[facilitate] 生成 {len(phrases)} 个词块, {len(dialogue.get('lines',[]))} 轮对话, {len(exercises)} 道练习")
                _add_translations(result)
                return result

            logger.warning(f"[facilitate] JSON 结构不完整，重试...")
        except Exception as e:
            logger.warning(f"[facilitate] 尝试 {attempt + 1} 失败: {e}")

    raise RuntimeError(
        f"LLM 生成失败（场景={scene_type}），已重试2次仍无法获取有效结果"
    )


def _add_translations(result: Dict[str, Any]) -> None:
    """
    为促成材料的英文显示补充 _en 字段。
    批量翻译中文字段（function/title/context/explanation/gap_target），
    英文对话内容（sentence/lines/options）不翻译。失败时静默降级。
    """
    try:
        from services.ai_service import _translate_texts

        translate_fields: Dict[str, str] = {}

        phrases = result.get("phrases", [])
        if isinstance(phrases, list):
            for i, p in enumerate(phrases):
                if isinstance(p, dict) and p.get("function"):
                    translate_fields[f"phrases_{i}_function"] = p["function"]

        dialogue = result.get("dialogue", {})
        if isinstance(dialogue, dict) and dialogue.get("title"):
            translate_fields["dialogue_title"] = dialogue["title"]

        exercises = result.get("exercises", [])
        if isinstance(exercises, list):
            for i, ex in enumerate(exercises):
                if isinstance(ex, dict):
                    for fk in ("context", "explanation", "gap_target"):
                        if ex.get(fk):
                            translate_fields[f"exercises_{i}_{fk}"] = ex[fk]

        if not translate_fields:
            return

        translations = _translate_texts(translate_fields)

        if isinstance(phrases, list):
            for i, p in enumerate(phrases):
                if isinstance(p, dict) and f"phrases_{i}_function" in translations:
                    p["function_en"] = translations[f"phrases_{i}_function"]

        if isinstance(dialogue, dict) and "dialogue_title" in translations:
            dialogue["title_en"] = translations["dialogue_title"]

        if isinstance(exercises, list):
            for i, ex in enumerate(exercises):
                if isinstance(ex, dict):
                    for fk in ("context", "explanation", "gap_target"):
                        en_key = f"exercises_{i}_{fk}"
                        if en_key in translations:
                            ex[f"{fk}_en"] = translations[en_key]

        logger.info(f"[facilitate] 已补充 {len(translations)} 个英文字段")
    except Exception as e:
        logger.warning(f"[facilitate] 材料翻译失败（不影响流程）: {e}")
