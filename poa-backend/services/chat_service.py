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

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"
TTS_DIR = "uploads/tts"

# ---- 开场白 Prompt ----
_OPENING_PROMPT = """\
You are an AI conversation partner in an English learning scenario.
Generate a natural, friendly opening line that fits the task context.
Keep it under 25 words. DO NOT output anything other than the opening sentence."""

# ---- 回复 Prompt ----
_REPLY_PROMPT = """\
You are an AI conversation partner in an English learning scenario.
Your role: act according to the task context provided.

Rules:
- Reply in English, ONE sentence, under 25 words.
- Stay in character (barista, librarian, receptionist, etc.).
- Respond naturally to what the user just said.
- If the user's sentence has a grammar or politeness mistake, subtly model the correct form in your reply.
- DO NOT explain, DO NOT use markdown, just the sentence."""


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
    variant = task_context.get("variant_context", "")

    # 尝试 LLM
    try:
        prompt = (
            f"Scenario: {scene}. Roles: {roles}. "
            + (f"Variant context: {variant}. " if variant else "")
            + "Generate a short, friendly opening line in English."
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
) -> str:
    """
    根据对话历史和用户最新输入，调用 LLM 生成 AI 下一句回复。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")

    # 构建 messages
    messages = [
        {
            "role": "system",
            "content": (
                f"{_REPLY_PROMPT}\n\n"
                f"Task context: scene={scene}, roles={roles}\n"
                + (f"Variant: {task_context.get('variant_context', '')}\n"
                   if task_context.get("variant_context") else "")
            ),
        }
    ]

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
        return text
    except Exception as e:
        logger.warning(f"[chat] LLM 回复失败: {e}，降级 Mock")
        return _mock_reply(user_text, task_context)


def _mock_reply(user_text: str, task_context: Dict[str, Any]) -> str:
    """Mock 降级回复"""
    replies = [
        "Sure, what would you like?",
        "Anything else I can help you with?",
        "Let me check that for you.",
        "That'll be $5.50, please.",
        "Would you like anything to drink with that?",
        "Sorry, could you repeat that?",
    ]
    # 简单根据用户内容选择回复
    lowered = user_text.lower()
    if "how much" in lowered or "price" in lowered:
        return "That'll be $5.50, please."
    if "thank" in lowered:
        return "You're welcome! Have a great day!"
    if "?" in user_text:
        return "Let me check that for you."
    return random.choice(replies)


# ============================================================
# 3. TTS 文本转语音（pyttsx3 优先 → gTTS 降级）
# ============================================================
def text_to_speech(text: str) -> str:
    """
    将文本转为音频文件，保存到 uploads/tts/。
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
            return f"/{filepath.replace(os.sep, '/')}"

        engine = pyttsx3.init()
        engine.setProperty("rate", 150)
        engine.save_to_file(text, filepath)
        engine.runAndWait()

        if os.path.isfile(filepath):
            url = f"/{filepath.replace(os.sep, '/')}"
            logger.info(f"[TTS] pyttsx3 生成成功: {url}")
            return url
    except Exception as e:
        logger.warning(f"[TTS] pyttsx3 失败: {e}，尝试 gTTS...")

    # ---- 策略 2: gTTS（需联网） ----
    try:
        filename = f"{text_hash}.mp3"
        filepath = os.path.join(TTS_DIR, filename)

        if os.path.isfile(filepath):
            logger.info(f"[TTS] gTTS 缓存命中: {filepath}")
            return f"/{filepath.replace(os.sep, '/')}"

        tts = gTTS(text=text, lang="en", slow=False)
        tts.save(filepath)
        url = f"/{filepath.replace(os.sep, '/')}"
        logger.info(f"[TTS] gTTS 生成成功: {url}")
        return url
    except Exception as e:
        logger.warning(f"[TTS] gTTS 失败: {e}")

    # ---- 全部失败 ----
    logger.error(f"[TTS] 所有 TTS 方案均失败，返回空")
    return ""
