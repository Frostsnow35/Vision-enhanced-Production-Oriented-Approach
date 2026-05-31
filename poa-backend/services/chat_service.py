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


# ============================================================
# 1. 开场白
# ============================================================
def generate_opening(task_context: Dict[str, Any]) -> str:
    """
    根据任务场景生成 AI 开场白。调用 LLM，失败抛出异常。
    """
    scene = task_context.get("scene_label", "")
    roles = task_context.get("roles", "")
    variant = task_context.get("variant_context", "")

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
