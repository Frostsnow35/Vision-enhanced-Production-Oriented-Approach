"""
对话服务 —— 开场白生成 + LLM 回复。
"""
import logging
from typing import Any, Dict, List

import httpx

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

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


def _fallback_opening(scene: str, roles: str, variant: str) -> str:
    """LLM 不可用时的降级开场白。"""
    label = (scene + roles + variant).lower()
    if not variant:
        if "咖啡" in label or "cafe" in label or "coffee" in label:
            return "Hi there! What can I get for you today?"
        if "图书馆" in label or "library" in label:
            return "Welcome to the library! How can I help you find what you need?"
        if "餐厅" in label or "restaurant" in label or "dining" in label:
            return "Good evening! Do you have a reservation?"
        if "医院" in label or "hospital" in label or "clinic" in label:
            return "Hello, how can I help you today?"
        if "机场" in label or "airport" in label or "flight" in label:
            return "Good morning! Where are you flying to today?"
        if "商场" in label or "mall" in label or "shop" in label or "store" in label:
            return "Hello! Welcome! How can I assist you?"
        return "Hello! How can I help you today?"
    if "做错" in variant or "mistake" in variant or "wrong" in variant:
        return "I'm sorry about that. Let me check what went wrong with your order."
    if "优惠" in variant or "discount" in variant or "sale" in variant:
        return "Welcome! Just so you know, we have a special promotion today."
    return "Let's continue. How can I assist you this time?"


# ============================================================
# 1. 开场白
# ============================================================
def generate_opening(task_context: Dict[str, Any]) -> str:
    """
    根据任务场景生成 AI 开场白。LLM 超时或失败时降级返回预设开场白。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")
    variant = task_context.get("variant_context", "")

    prompt = (
        f"Scenario: {scene}. Roles: {roles}. "
        + (f"Variant context: {variant}. " if variant else "")
        + "Generate a short, friendly opening line in English."
    )
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _OPENING_PROMPT},
                {"role": "user", "content": prompt},
            ],
        }
        with httpx.Client(timeout=120.0) as client:
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
    except httpx.ReadTimeout:
        logger.warning("[chat] LLM 开场白超时，降级")
    except Exception as e:
        logger.warning(f"[chat] LLM 开场白失败: {e}，降级")

    fallback = _fallback_opening(scene, roles, variant)
    logger.info(f"[chat] 降级开场白: {fallback}")
    return fallback


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
    LLM 超时或失败时降级返回预设回复。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")

    messages: List[Dict[str, str]] = [
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

    recent = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
    for turn in recent:
        role = "assistant" if turn.get("role") == "ai" else "user"
        text = turn.get("text") or turn.get("content") or "[audio message]"
        messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": user_text})

    logger.info(f"[chat] 调用 LLM 生成回复 — history={len(recent)} turns")

    try:
        body = {"model": DOUBAO_MODEL_ID, "messages": messages}
        with httpx.Client(timeout=120.0) as client:
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
    except httpx.ReadTimeout:
        logger.warning("[chat] LLM 回复超时，降级")
    except Exception as e:
        logger.warning(f"[chat] LLM 回复失败: {e}，降级")

    lowered = user_text.lower()
    if "how much" in lowered or "price" in lowered:
        return "That'll be $5.50, please."
    if "thank" in lowered:
        return "You're welcome! Have a great day!"
    if "?" in user_text:
        return "Let me check that for you."
    return "Sure, what would you like?"
