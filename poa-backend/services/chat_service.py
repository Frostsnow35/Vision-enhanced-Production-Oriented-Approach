"""
对话服务 —— 开场白生成 + LLM 回复 + TTS 语音合成。
"""
import difflib
import hashlib
import json
import logging
import os
import random
import re
import uuid
from typing import Any, Dict, List

import httpx
from gtts import gTTS

from config import (
    DOUBAO_API_KEY,
    DOUBAO_BASE_URL,
    DOUBAO_MODEL_ID,
    DOUBAO_TTS_APP_ID,
    DOUBAO_TTS_TOKEN,
    DOUBAO_TTS_VOICE,
    DOUBAO_TTS_RESOURCE_ID,
    DOUBAO_TTS_URL,
    UPLOAD_DIR,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_service")

def _clean_think(text: str) -> str:
    """移除 LLM 泄露的 </think...> 标签"""
    return re.sub(r'</?think[^>]*>', '', text).strip()

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"
TTS_DIR = os.path.join(UPLOAD_DIR, "tts")

_CLOSING_LINE_MATCH_THRESHOLD = 0.65

# ---- 开场白 Prompt ----
_OPENING_PROMPT = """\
You are an AI conversation partner in a task-based English learning scenario.
Generate the FIRST opening line to start the conversation.
Your opening must:
- Fit the scene, your role, and the communicative goal.
- Be a natural opener that invites the student to speak (ask a question or offer service).
- Use scene-specific vocabulary: mention actual products/services/locations relevant to the scene (e.g. latte/espresso for cafe, boarding gate/luggage for airport, appointment/prescription for hospital).
- Reflect your role's tone: friendly and warm for service roles, professional and calm for medical/library roles.
- If the variant context implies a problem (mistake/delay/complaint), start by acknowledging it before asking.
- Keep it under 30 words.
- DO NOT output anything other than the opening sentence.
- NEVER use generic openers like "Hi there! What can I get for you today?" or "Hello! How can I help you today?" — be specific to THIS scene."""

# ---- 回复 Prompt ----
_REPLY_PROMPT = """\
You are an AI conversation partner in a task-based English learning scenario.
Your job is to help the student practice English for a SPECIFIC communicative task.

=== YOUR IDENTITY ===
Your persona and the scene are defined in the task context below. Stay in character at all times.

=== CORE RULES ===

1. STAY ON TASK
Everything you say must relate to the scenario and the learning goal. Never introduce topics or questions outside this specific situation.

2. RESPOND SPECIFICALLY — CLOSE THE LOOP BEFORE MOVING ON (HIGHEST PRIORITY)
This is the MOST IMPORTANT rule. You MUST build your reply around what the student literally just said.
- Read the student's last message word by word. Identify the key content words (nouns, verbs, adjectives).
- If they ordered something → repeat it back to confirm: "A medium latte, sure!"
- If they asked a question → ANSWER IT DIRECTLY AND SPECIFICALLY: "Yes, we have vanilla, chocolate, and caramel." Do NOT skip the answer.
- If they made a request → address that request first: "Of course, let me check the back."
- You MUST include at least one keyword from the student's last message in your reply.
- **FORBIDDEN**: Do NOT use "Anything else?" / "What else can I help?" / "Is there anything else?" / "What would you like?" as your first or only response to a specific question. These are conversation-killers. ALWAYS answer the specific question FIRST, then you may ask what's next.
- BAD example: Student: "Do you have any other flavors?" → AI: "What else can I help you with?" ← FORBIDDEN
- GOOD example: Student: "Do you have any other flavors?" → AI: "Yes! We have vanilla, chocolate, and caramel. Would you like to try one of those?"

3. MODEL CORRECTIONS SUBTLY
If the student makes a grammar or politeness error, echo back the correct form naturally in your reply. Do NOT say "you made a mistake" or explicitly correct them.

4. HANDLE OFF-TOPIC (PROGRESSIVE ESCALATION)
Track how many times the student has wandered off-topic and escalate:
Level 1 (1st off-topic): Gently steer back. Use phrases like "By the way, about your order..." or "Before I forget..."
Level 2 (2nd off-topic): Politely but directly redirect. "Let's stay focused on your task. {task-related prompt}" 
Level 3 (3rd+ off-topic): Firmly decline and return to task. "I'd love to chat about that later, but right now let's finish your task first. {task-related prompt}"
Only treat a turn as off-topic if the student's message is clearly unrelated to the scenario (e.g. talking about video games in a coffee shop). Short or imperfect English is NOT off-topic.

5. HANDLE INVALID INPUT
- If the student's text is [inaudible], [silence], garbled noise, or empty: politely ask them to repeat.
- If the student speaks Chinese or another non-English language: gently remind them to use English.

6. END THE CONVERSATION (MANDATORY 3-STEP CHECKLIST)
Before ending, evaluate ALL THREE checks. The conversation ends if and only if all 3 are true:
  - Check 1 (Sub-goals): ALL communicative sub-goals are achieved (e.g., for a cafe scene: drink + size + temperature + add-ons all confirmed).
  - Check 2 (Farewell): A natural farewell has been exchanged by both sides (you said goodbye / "enjoy your ..." and the student accepted it).
  - Check 3 (No pending): There is NO unresolved question or pending request from the student.
If all 3 = TRUE: append the EXACT marker [CONVERSATION_COMPLETE] to the very END of your reply, AFTER a natural farewell sentence.
If any = FALSE: DO NOT append the marker. Continue the conversation naturally.
NEVER use variants like [END], [conversation ended], ***end***. The exact string [CONVERSATION_COMPLETE] is required.
Example end: "Enjoy your latte! Have a great day. [CONVERSATION_COMPLETE]"
Example continue: "What size would you like — small, medium, or large?"

7. STYLE
Reply in English. Keep responses concise but use natural, conversational full sentences. Do NOT use markdown. Do NOT explain your teaching strategy. Use appropriate politeness for your role."""


# ---- 实时短反馈 Prompt ----
_TURN_FEEDBACK_PROMPT = """\
You are an English oral practice evaluator. Given the student's most recent message in the conversation, give a SHORT, specific feedback for this turn.

【Rules】
1. Identify up to 3 dimensions this turn touches (use these EXACT Chinese names from the seven-dimension evaluation system):
   - 发音标准度
   - 语法规范性
   - 词汇适配性
   - 语言功能达成度
   - 语用策略得体性
   - 话语回适合配性
   - 副语言匹配度
   Note: For text-only input, prefer 语法规范性 / 词汇适配性 / 语用策略得体性 / 话语回适合配性.
2. short_comment (15-30 Chinese chars): must quote the student's exact wording or specific words from this turn. Be specific and actionable.
3. If the student input is [inaudible] / empty / garbled, return empty dimensions and a short comment asking them to repeat.

【Output】STRICT JSON, nothing else:
{
  "dimensions": ["语法规范性", "语用策略得体性"],
  "short_comment": "建议用 'I would like' 替代 'I want'，表达更礼貌。"
}
"""


def _match_closing_line(ai_text: str, closing_line: str) -> bool:
    """
    比对 AI 回复是否与任务的 closing_line 语义相近。
    用于 is_final 的提前识别：AI 没打 [CONVERSATION_COMPLETE] 标记，
    但语义上已收束时，视为对话结束。

    实现：SequenceMatcher 比对，阈值 0.65。
    缺失时返回 False（不抛异常）。
    """
    if not ai_text or not closing_line:
        return False
    a = ai_text.strip().lower()
    b = closing_line.strip().lower()
    if not a or not b:
        return False
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    return ratio >= _CLOSING_LINE_MATCH_THRESHOLD


def _generate_turn_feedback(user_text: str, ai_text: str, task_context: Dict[str, Any]) -> Dict[str, Any]:
    """
    为本轮对话生成实时短反馈。失败时返回空 dict，前端不渲染卡片。
    使用 LLM（doubao），失败返回 {}。
    """
    # 兜底过滤：inaudible / 过短 / 包含方括号噪点
    if not user_text or user_text.strip() in ("[inaudible]", "[silence]", "", "[audio message]"):
        return {
            "dimensions": ["话语回适合配性"],
            "short_comment": "没有听清，请再试一次。",
        }
    if len(user_text.strip()) < 3:
        return {}

    try:
        scene = task_context.get("scene_label", "")
        prompt = (
            f"Scene: {scene}\n"
            f"Student's most recent message: \"{user_text[:300]}\"\n"
            f"AI's reply (for context): \"{(ai_text or '')[:200]}\"\n"
            "Generate the feedback JSON now."
        )
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _TURN_FEEDBACK_PROMPT},
                {"role": "user", "content": prompt},
            ],
        }
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        text = _clean_think(resp.json()["choices"][0]["message"]["content"])
        import json as _json
        # 容忍 markdown code fence
        cleaned = text
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()
        data = _json.loads(cleaned)
        dims = data.get("dimensions", []) or []
        comment = (data.get("short_comment") or "").strip()
        # 字段裁剪：dimensions ≤ 3，short_comment ≤ 80 字
        dims = [d for d in dims if isinstance(d, str)][:3]
        if len(comment) > 80:
            comment = comment[:78] + "..."
        return {"dimensions": dims, "short_comment": comment}
    except Exception as e:
        logger.warning(f"[chat] turn_feedback 生成失败: {e}")
        return {}


# ============================================================
# 1. 开场白
# ============================================================
def generate_opening(task_context: Dict[str, Any]) -> str:
    """
    根据任务场景生成 AI 开场白。
    优先调用 LLM，失败时降级为 Mock。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")
    goal = task_context.get("goal", "")
    variant = task_context.get("variant_context", "")

    # 尝试 LLM
    try:
        prompt = (
            f"Scenario: {scene}. Your role: {roles}. "
            + (f"Communicative goal: {goal}. " if goal else "")
            + (f"Variant context: {variant}. " if variant else "")
            + ("This is the student's SECOND attempt at this scenario — they have been practicing and should show improvement. Note: do NOT explicitly mention 'second attempt' to the student — just engage naturally. " if variant else "")
            + "Generate a natural first opening line in English to invite the student into the conversation."
        )
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _OPENING_PROMPT},
                {"role": "user", "content": prompt},
            ],
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        text = _clean_think(resp.json()["choices"][0]["message"]["content"])
        logger.info(f"[chat] LLM 开场白: {text[:80]}")
        return text
    except Exception as e:
        logger.warning(f"[chat] LLM 开场白失败: {e}，降级 Mock")

    # Mock 降级
    return _mock_opening(scene, roles, variant)


def _mock_opening(scene: str, roles: str, variant: str) -> str:
    label = (scene + roles + variant).lower()

    # 变体开场白（先检查，因为变体优先匹配）
    if "做错" in variant or "mistake" in label or "wrong" in label:
        return random.choice([
            "I'm so sorry about that! Let me check what went wrong and fix it for you.",
            "Oh, I see there's been a mistake. Let me sort this out right away.",
            "I apologize for the mix-up. Could you tell me exactly what happened?",
        ])
    if "优惠" in variant or "discount" in label or "sale" in label or "promo" in label:
        return random.choice([
            "Welcome! Just so you know, we're running a special promotion today — 20% off on all items. How can I help?",
            "Hello! Great timing — we have a flash sale right now. What are you looking for?",
            "Hi there! Happy hour just started, so you're in luck. What would you like?",
        ])
    if "迟到" in variant or "delay" in label or "late" in label:
        return random.choice([
            "I'm afraid there's been a delay. Let me help you figure out an alternative.",
            "Sorry about the wait. Let me take care of you right now.",
            "Thanks for your patience. Let's get this sorted out as quickly as possible.",
        ])
    if "超重" in variant or "overweight" in label or "luggage" in label or "bag" in label:
        return random.choice([
            "I'm sorry, but your luggage seems to be over the weight limit. Let's discuss your options.",
            "Excuse me — your bag is a bit over the allowance. Let me explain the options we have.",
        ])

    # ---- 按场景分类的丰富模板 ----
    if "咖啡" in label or "cafe" in label or "coffee" in label:
        return random.choice([
            "Good morning! Our single-origin Ethiopian pour-over is fantastic today. What catches your eye?",
            "Hi! Welcome to Brew & Co. Are you in the mood for something hot or iced today?",
            "Hey there! Our seasonal special — a lavender honey latte — just launched. Want to try it?",
            "Welcome in! First time here? Our espresso and cold brew are both very popular.",
            "Hi! Can I start you off with a drink? We've got fresh pastries too if you're interested.",
        ])
    if "图书馆" in label or "library" in label:
        return random.choice([
            "Welcome to the library! Are you looking for anything specific today, or just browsing?",
            "Good afternoon! Just to let you know, we have a new arrivals section near the front desk.",
            "Hello! How can I help you find what you need? I can check our catalog for you.",
            "Welcome! If you need help navigating the sections, I'm happy to point you in the right direction.",
        ])
    if "餐厅" in label or "restaurant" in label or "dining" in label:
        return random.choice([
            "Good evening! Do you have a reservation with us tonight?",
            "Welcome to The Garden Table! Table for how many this evening?",
            "Hi, welcome! Would you prefer to sit indoors or on the patio today?",
            "Good evening! Our chef's special tonight is the pan-seared salmon — would you like to hear the full specials?",
        ])
    if "医院" in label or "hospital" in label or "clinic" in label or "medical" in label:
        return random.choice([
            "Hello, how can I help you today? Do you have an appointment?",
            "Good morning. Are you here for a scheduled appointment, or do you need to see a doctor urgently?",
            "Hi there. I'm Dr. Chen's nurse. Could you describe what brought you in today?",
            "Hello. Before we start, could you tell me about any symptoms you've been experiencing?",
        ])
    if "机场" in label or "airport" in label or "flight" in label:
        return random.choice([
            "Good morning! May I see your passport and booking reference, please?",
            "Hello! Are you checking in any bags today, or just carry-on?",
            "Good morning! Where are you flying to today? I'll get you checked in.",
            "Hi there! Window or aisle seat? And do you have any luggage to check in?",
        ])
    if "商场" in label or "mall" in label or "shop" in label or "store" in label:
        return random.choice([
            "Hello! Welcome! Are you looking for anything in particular today?",
            "Hi there! Just to let you know, we have a buy-one-get-one sale on winter items. Can I help you find something?",
            "Welcome! Feel free to look around, and let me know if you need any sizes or colors.",
            "Good afternoon! Is there a specific style or brand you're interested in?",
        ])

    # 默认备用
    defaults = [
        "Hello! How can I assist you today?",
        "Good day! What brings you here?",
        "Hi! Let me know how I can help.",
    ]
    return random.choice(defaults)


# ============================================================
# 2. 生成回复（LLM）
# ============================================================
def generate_reply(
    conversation_history: List[Dict[str, Any]],
    user_text: str,
    task_context: Dict[str, Any],
):
    """
    根据对话历史和用户最新输入，调用 LLM 生成 AI 下一句回复。
    返回 (ai_text: str, is_final: bool)。
    当对话交际目标达成时 is_final=True，前端可据此提示用户提交诊断。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")
    goal = task_context.get("goal", "")
    evaluation_criteria = task_context.get("evaluation_criteria", "")

    # 构建 system message
    system_content = _REPLY_PROMPT + "\n\n" + f"Scene: {scene}\nYour role: {roles}"
    if goal:
        system_content += f"\nCommunicative goal: {goal}"
    if evaluation_criteria:
        system_content += f"\nEvaluation focus: {evaluation_criteria}"
    if task_context.get("variant_context"):
        variant_text = task_context.get("variant_context", "")
        system_content += (
            f"\n\n--- CONTEXT: SECOND ATTEMPT ---"
            f"\nThis is the student's SECOND attempt at this scenario."
            f"\nThey have completed one full conversation, received diagnostic feedback on their weaknesses,"
            f"\nand been given targeted learning materials to improve."
            f"\nThe scenario now has a new twist: {variant_text}"
            f"\nYou should maintain the same teaching role. Note that the student is expected to show progress."
            f"\nHowever, do NOT mention any of this to the student — just engage naturally in the scene."
        )

    messages = [{"role": "system", "content": system_content}]

    # 追加最近 6 轮对话历史
    recent = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
    for turn in recent:
        role = "assistant" if turn.get("role") == "ai" else "user"
        text = turn.get("text") or turn.get("content") or "[audio message]"
        messages.append({"role": role, "content": text})

    # 追加当前用户输入
    messages.append({"role": "user", "content": user_text})

    logger.info(f"[chat] 调用 LLM 生成回复 — history={len(recent)} turns")

    try:
        body = {"model": DOUBAO_MODEL_ID, "messages": messages}
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        text = _clean_think(resp.json()["choices"][0]["message"]["content"])
        logger.info(f"[chat] LLM 回复: {text[:80]}")
        ai_text, is_final = _extract_completion_flag(text)

        # 收尾语提前识别：若 AI 未打标记但语义与 closing_line 相近，视为结束
        closing_line = task_context.get("closing_line", "")
        if not is_final and _match_closing_line(ai_text, closing_line):
            logger.info(f"[chat] 收尾语匹配命中，is_final 提前置 True")
            is_final = True

        return ai_text, is_final
    except Exception as e:
        logger.warning(f"[chat] LLM 回复失败: {e}，降级 Mock")
        ai_text, is_final = _mock_reply(user_text, task_context)
        return ai_text, is_final


def _extract_completion_flag(text: str):
    """
    从 AI 回复中检测并剥离 [CONVERSATION_COMPLETE] 标记。
    返回 (clean_text, is_final)。
    含兜底检测：如果未找到标记但文本含强结束语，也标记为完成。
    """
    import re

    marker = "[CONVERSATION_COMPLETE]"
    marker_lower = marker.lower()

    is_final = False
    clean_text = text

    if marker in text:
        is_final = True
        clean_text = text.replace(marker, "").strip()
    elif marker_lower in text.lower():
        is_final = True
        clean_text = re.sub(re.escape(marker), "", text, flags=re.IGNORECASE).strip()

    # 兜底：标记未出现但文本含强结束模式
    if not is_final:
        endings = [
            r"have a great day",
            r"enjoy your (coffee|meal|flight|day|book|stay|visit)",
            r"goodbye",
            r"see you",
            r"take care",
        ]
        combined = "|".join(endings)
        if re.search(combined, text.lower()) and len(text.split()) <= 20:
            is_final = True
            logger.info(f"[chat] 兜底检测到对话结束信号: {text[:60]}")

    return clean_text, is_final


def _mock_reply(user_text: str, task_context: Dict[str, Any]):
    """Mock 降级回复，返回 (text, is_final)。"""
    lowered = user_text.lower()

    if "thank" in lowered or "thanks" in lowered:
        replies = [
            ("You're welcome! Have a great day!", True),
            ("My pleasure! Have a wonderful day!", True),
        ]
        return random.choice(replies)

    if "goodbye" in lowered or "bye" in lowered:
        return ("Goodbye! Take care!", True)

    replies = [
        ("Sure, what would you like?", False),
        ("Anything else I can help you with?", False),
        ("Let me check that for you.", False),
        ("That'll be $5.50, please.", False),
        ("Would you like anything to drink with that?", False),
        ("Sorry, could you repeat that?", False),
    ]

    if "how much" in lowered or "price" in lowered:
        return ("That'll be $5.50, please.", False)
    if "?" in user_text:
        return ("Let me check that for you.", False)
    return random.choice(replies)


# ============================================================
# 4. Plan A 收尾调用（自然告别 + 强制结束标记）
# ============================================================
_CLOSING_LINE_SYSTEM_HINT = """\
The conversation has reached the turn limit. The student cannot speak again.
Your task:
1. Respond to any last thing the student said (acknowledge it briefly).
2. Give a NATURAL, scene-specific farewell (e.g., "Enjoy your coffee!" for a cafe, "Have a safe flight!" for an airport).
3. Append the EXACT marker [CONVERSATION_COMPLETE] at the very end.
Keep it under 30 words. Stay in character."""


def request_closing_line(task_context: Dict[str, Any]):
    """
    Plan A 收尾调用：构造 system 提示让 AI 自然告别并打 [CONVERSATION_COMPLETE] 标记。
    返回 (ai_text, is_final)。失败时降级为通用告别 + is_final=True。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")
    goal = task_context.get("goal", "")
    closing_line = task_context.get("closing_line", "")

    system_content = _CLOSING_LINE_SYSTEM_HINT
    if scene:
        system_content += f"\n\nScene: {scene}"
    if roles:
        system_content += f"\nYour role: {roles}"
    if closing_line:
        system_content += f"\nSuggested farewell (adapt to actual context): {closing_line}"

    user_message = "Please wrap up the conversation with a natural, scene-specific farewell. Remember to append [CONVERSATION_COMPLETE] at the end."

    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_message},
            ],
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        text = _clean_think(resp.json()["choices"][0]["message"]["content"])
        logger.info(f"[chat] Plan A 收尾 LLM 回复: {text[:80]}")
        ai_text, is_final = _extract_completion_flag(text)
        if not is_final:
            # 兜底：Plan A 调用中，AI 应该已经说告别，强制标记为结束
            is_final = True
        return ai_text, is_final
    except Exception as e:
        logger.warning(f"[chat] Plan A 收尾 LLM 失败: {e}，降级为通用告别")
        # 降级：如果有预生成的 closing_line 就用它，否则用通用告别
        fallback = closing_line.strip() if closing_line else "Thanks for chatting with me! Have a great day."
        if not fallback.endswith("[CONVERSATION_COMPLETE]"):
            fallback = fallback + " [CONVERSATION_COMPLETE]"
        ai_text, is_final = _extract_completion_flag(fallback)
        return ai_text, True


# ============================================================
# 3. TTS 文本转语音（豆包 TTS 优先 → gTTS 降级）
# ============================================================
def text_to_speech(text: str) -> str:
    """
    将文本转为音频文件，保存到 TTS_DIR。
    策略：豆包 TTS（在线，英文纯正）优先，失败则用 gTTS（降级）。
    返回音频 URL（如 /uploads/tts/abc.mp3），失败返回空字符串。
    """
    os.makedirs(TTS_DIR, exist_ok=True)
    text_hash = hashlib.md5(text.encode()).hexdigest()[:12]

    # ---- 策略 1: 豆包 TTS ----
    try:
        filename = f"{text_hash}.mp3"
        filepath = os.path.join(TTS_DIR, filename)
        if os.path.isfile(filepath):
            logger.info(f"[TTS] 豆包缓存命中: {filepath}")
            return f"/uploads/tts/{filename}"

        # 调用火山引擎 TTS V3 API（流式单向合成）
        headers = {
            "X-Api-App-Id": DOUBAO_TTS_APP_ID,
            "X-Api-Access-Key": DOUBAO_TTS_TOKEN,
            "X-Api-Resource-Id": DOUBAO_TTS_RESOURCE_ID,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "Content-Type": "application/json",
        }
        body = {
            "user": {"uid": "poa_user"},
            "namespace": "BidirectionalTTS",
            "req_params": {
                "text": text,
                "speaker": DOUBAO_TTS_VOICE,
                "audio_params": {"format": "mp3", "sample_rate": 24000},
            },
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(DOUBAO_TTS_URL, headers=headers, json=body)
            resp.raise_for_status()
            # V3 流式响应：多行 JSON，每行含 code/data/is_final
            audio_b64_parts = []
            for line in resp.text.strip().split("\n"):
                if not line.strip():
                    continue
                chunk = json.loads(line)
                code = chunk.get("code", 0)
                if code not in (0, 20000000):
                    raise Exception(f"TTS API error code={code}: {chunk.get('message', 'unknown')}")
                data_val = chunk.get("data")
                if data_val:
                    audio_b64_parts.append(data_val)
            if not audio_b64_parts:
                raise Exception("TTS returned empty audio data")
            audio_b64 = "".join(audio_b64_parts)
            import base64 as _b64
            audio_data = _b64.b64decode(audio_b64)
            with open(filepath, "wb") as f:
                f.write(audio_data)
        logger.info(f"[TTS] 豆包生成成功: /uploads/tts/{filename}")
        return f"/uploads/tts/{filename}"
    except Exception as e:
        logger.warning(f"[TTS] 豆包 TTS 失败: {e}，降级 gTTS")

    # ---- 策略 2: gTTS 降级 ----
    try:
        filename = f"{text_hash}.mp3"
        filepath = os.path.join(TTS_DIR, filename)
        if os.path.isfile(filepath):
            logger.info(f"[TTS] gTTS 缓存命中: {filepath}")
            return f"/uploads/tts/{filename}"
        tts = gTTS(text=text, lang="en", slow=False)
        tts.save(filepath)
        logger.info(f"[TTS] gTTS 生成成功: /uploads/tts/{filename}")
        return f"/uploads/tts/{filename}"
    except Exception as e:
        logger.warning(f"[TTS] gTTS 失败: {e}")

    logger.error(f"[TTS] 所有 TTS 方案均失败，返回空")
    return ""
