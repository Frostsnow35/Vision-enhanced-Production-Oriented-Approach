"""
对话服务 —— 开场白生成 + LLM 回复 + TTS 语音合成。
"""
import hashlib
import logging
import os
import random
from typing import Any, Dict, List

import httpx
from gtts import gTTS

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL_ID, UPLOAD_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"
TTS_DIR = os.path.join(UPLOAD_DIR, "tts")

# ---- 开场白 Prompt ----
_OPENING_PROMPT = """\
You are an AI conversation partner in a task-based English learning scenario.
Generate the FIRST opening line to start the conversation.
Your opening must:
- Fit the scene, your role, and the communicative goal.
- Be a natural opener that invites the student to speak (ask a question or offer service).
- Keep it under 30 words.
- DO NOT output anything other than the opening sentence."""

# ---- 回复 Prompt ----
_REPLY_PROMPT = """\
You are an AI conversation partner in a task-based English learning scenario.
Your job is to help the student practice English for a SPECIFIC communicative task.

=== YOUR IDENTITY ===
Your persona and the scene are defined in the task context below. Stay in character at all times.

=== CORE RULES ===

1. STAY ON TASK
Everything you say must relate to the scenario and the learning goal. Never introduce topics or questions outside this specific situation.

2. RESPOND SPECIFICALLY
Always acknowledge what the student just said before adding your own input. If they ordered a latte, confirm it. If they asked a question, answer it directly. Show you listened.

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

6. END THE CONVERSATION
When the communicative task is naturally complete (all goals achieved, farewell exchanged), append the exact marker [CONVERSATION_COMPLETE] to the END of your reply. Use a natural farewell before the marker.
Example: "You're all set! Enjoy your coffee. [CONVERSATION_COMPLETE]"

7. STYLE
Reply in English. Keep responses concise but use natural, conversational full sentences. Do NOT use markdown. Do NOT explain your teaching strategy. Use appropriate politeness for your role."""


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
        text = resp.json()["choices"][0]["message"]["content"].strip()
        logger.info(f"[chat] LLM 开场白: {text[:80]}")
        return text
    except Exception as e:
        logger.warning(f"[chat] LLM 开场白失败: {e}，降级 Mock")

    # Mock 降级
    return _mock_opening(scene, roles, variant)


def _mock_opening(scene: str, roles: str, variant: str) -> str:
    label = (scene + roles + variant).lower()
    if not variant:
        if "咖啡" in label or "cafe" in label:
            return "Hi there! What can I get for you today?"
        if "图书馆" in label or "library" in label:
            return "Welcome to the library! How can I help you find what you need?"
        if "餐厅" in label or "restaurant" in label:
            return "Good evening! Do you have a reservation?"
        if "医院" in label or "hospital" in label:
            return "Hello, how can I help you today?"
        if "机场" in label or "airport" in label:
            return "Good morning! Where are you flying to today?"
        if "商场" in label or "mall" in label:
            return "Hello! Welcome! How can I assist you?"
        return "Hello! How can I help you today?"

    # 变体开场白
    if "做错" in variant or "mistake" in label or "wrong" in label:
        return "I'm sorry about that. Let me check what went wrong with your order."
    if "优惠" in variant or "discount" in label or "sale" in label:
        return "Welcome! Just so you know, we have a special promotion today. How can I help?"
    return "Let's continue. How can I assist you this time?"


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
        system_content += f"\nVariant: {task_context.get('variant_context')}"

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
        text = resp.json()["choices"][0]["message"]["content"].strip()
        logger.info(f"[chat] LLM 回复: {text[:80]}")
        ai_text, is_final = _extract_completion_flag(text)
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
# 3. TTS 文本转语音（pyttsx3 优先 → gTTS 降级）
# ============================================================
def text_to_speech(text: str) -> str:
    """
    将文本转为音频文件，保存到 TTS_DIR。
    策略：pyttsx3（离线）优先，失败则用 gTTS（需联网）。
    返回音频 URL（如 /uploads/tts/abc.wav），失败返回空字符串。
    """
    os.makedirs(TTS_DIR, exist_ok=True)

    text_hash = hashlib.md5(text.encode()).hexdigest()[:12]

    # ---- 策略 1: pyttsx3（离线） ----
    try:
        import pyttsx3

        filename = f"{text_hash}.wav"
        filepath = os.path.join(TTS_DIR, filename)

        if os.path.isfile(filepath):
            logger.info(f"[TTS] pyttsx3 缓存命中: {filepath}")
            return f"/uploads/tts/{filename}"

        engine = pyttsx3.init()
        engine.setProperty("rate", 150)
        engine.save_to_file(text, filepath)
        engine.runAndWait()

        if os.path.isfile(filepath):
            logger.info(f"[TTS] pyttsx3 生成成功: /uploads/tts/{filename}")
            return f"/uploads/tts/{filename}"
    except Exception as e:
        logger.warning(f"[TTS] pyttsx3 失败: {e}，尝试 gTTS...")

    # ---- 策略 2: gTTS（需联网） ----
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

    # ---- 全部失败 ----
    logger.error(f"[TTS] 所有 TTS 方案均失败，返回空")
    return ""
