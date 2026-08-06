"""
对话服务 —— 开场白生成 + LLM 回复 + TTS 语音合成。
"""
import difflib
import hashlib
import json
import logging
import os
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


def _clip_text(text: Any, limit: int = 160) -> str:
    """裁剪日志文本，避免单条日志过长。"""
    value = "" if text is None else str(text)
    value = value.replace("\n", "\\n")
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _serialize_messages_for_log(messages: List[Dict[str, Any]]) -> str:
    """将消息列表压缩为适合日志输出的预览。"""
    preview = []
    for message in messages:
        preview.append(
            {
                "role": message.get("role", ""),
                "content": _clip_text(message.get("content", ""), 120),
            }
        )
    return json.dumps(preview, ensure_ascii=False)


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
- If the variant context is provided, your opening MUST reflect the variant plot direction — do NOT use the same opener as the original scenario. For example, if variant context is about a wrong order, start by acknowledging the issue rather than asking "What can I get for you?"
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
Reply in English. Keep responses concise but use natural, conversational full sentences. Do NOT use markdown. Do NOT explain your teaching strategy. Use appropriate politeness for your role.

8. NEVER MAKE ONE-WAY PROMISES (CRITICAL)
You are role-playing in real time. You cannot actually leave to check anything. Therefore:
- FORBIDDEN: "Let me go ask the manager", "I'll check with my colleague", "Let me find out", "I need to confirm that", "I'll have to ask someone", "Let me see if we have that", "I have to check the system"
- Instead, give the RESULT directly: "According to our policy, we can offer you a 10% discount today." or "We currently have vanilla, chocolate, and caramel flavors available."
- If you truly don't know an answer, offer a concrete alternative: "Unfortunately we're out of that, but I'd recommend our seasonal special instead."
- BAD: Student: "Can I get a refund?" → AI: "Let me go ask the store manager."
- GOOD: Student: "Can I get a refund?" → AI: "Yes, as long as you have the receipt, I can process that right now."

9. NO QUESTION-BOUNCING — CONFIRM THEN GUIDE
After the student provides substantive input (an order, a question, a request), you MUST:
- Step 1: ACKNOWLEDGE / CONFIRM what they said first. Echo back their key content.
- Step 2: Then naturally ask your next question or move the task forward.
- BAD: Student: "I want a latte." → AI: "What size would you like?" (missing confirmation — sounds robotic)
- GOOD: Student: "I want a latte." → AI: "A latte, great choice! What size — small, medium, or large?"
- BAD: Student: "Do you have any other flavors?" → AI: "What kind do you like?" (bouncing back without answering)
- GOOD: Student: "Do you have any other flavors?" → AI: "Yes, we have vanilla, chocolate, and caramel. Which one sounds good to you?"

10. STAY ON THE VARIANT PLOT
When the task context includes a variant_plot (a new twist for the scenario), ALL of your replies must stay within that plot direction.
- Do NOT revert to the original scenario task.
- Do NOT introduce unrelated subplots or side topics.
- Example: If variant_plot = "The student's order was made wrong and they need to complain", do NOT casually start talking about daily specials or weather.
- If the student wanders off-topic, use the progressive escalation in Rule 4 to steer them back to the variant plot."""


# ---- 实时短反馈 Prompt ----
_TURN_FEEDBACK_PROMPT = """\
You are an English oral practice evaluator. Given the student's most recent message in the conversation, give a SHORT, specific feedback for this turn.

【Rules】
1. scores: three separate integer scores (0-100), one for each text quality dimension:
   - grammar: Grammar correctness (语法规范性) — tense, subject-verb agreement, word order, articles
   - vocabulary: Vocabulary appropriateness (词汇适配性) — word choice accuracy, collocation, scene-appropriate terms
   - coherence: Conversational coherence & politeness (话语回适合配性) — turn-taking quality, relevance to context, politeness level
   Do NOT evaluate voice/pronunciation/prosody — text input only.
   Scoring anchor:
   - 90-100: near-native, accurate and natural
   - 70-89: generally correct but with minor errors or slightly awkward phrasing
   - 50-69: basic communication achieved but with noticeable grammar/vocab issues
   - 0-49: barely understandable or completely off-topic
2. short_comment (15-30 Chinese chars): must quote the student's exact wording or specific words from this turn. Be specific and actionable.
3. If the student input is [inaudible] / empty / garbled, return all scores=0 and a short comment asking them to repeat.

【Output】STRICT JSON, nothing else:
{
  "scores": {"grammar": 78, "vocabulary": 85, "coherence": 72},
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


def _validate_score(val) -> int:
    """校验单个评分为 0-100 的整数。"""
    try:
        s = int(val)
        return max(0, min(100, s))
    except (ValueError, TypeError):
        return 0


def _generate_turn_feedback(user_text: str, ai_text: str, task_context: Dict[str, Any]) -> Dict[str, Any]:
    """
    为本轮对话生成实时短反馈（三维评分 + 短评）。失败时返回空 dict，前端不渲染。
    使用 LLM（doubao），失败返回 {}。
    """
    # 兜底过滤：inaudible / 过短 / 包含方括号噪点
    if not user_text or user_text.strip() in ("[inaudible]", "[silence]", "", "[audio message]"):
        return {
            "scores": {"grammar": 0, "vocabulary": 0, "coherence": 0},
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
        comment = (data.get("short_comment") or "").strip()
        if len(comment) > 80:
            comment = comment[:78] + "..."

        # 解析 scores：优先新格式 {"grammar":78,"vocabulary":85,"coherence":72}
        raw_scores = data.get("scores")
        if isinstance(raw_scores, dict):
            scores = {
                "grammar": _validate_score(raw_scores.get("grammar", 0)),
                "vocabulary": _validate_score(raw_scores.get("vocabulary", 0)),
                "coherence": _validate_score(raw_scores.get("coherence", 0)),
            }
        elif "score" in data:
            # 兼容旧格式（单总分）
            s = _validate_score(data["score"])
            scores = {"grammar": s, "vocabulary": s, "coherence": s}
        else:
            scores = None

        result: Dict[str, Any] = {"short_comment": comment}
        if scores:
            result["scores"] = scores
        return result
    except Exception as e:
        logger.warning(f"[chat] turn_feedback 生成失败: {e}")
        return {}


# ============================================================
# 1. 开场白
# ============================================================
def generate_opening(task_context: Dict[str, Any]) -> str:
    """
    根据任务场景生成 AI 开场白。
    调用 LLM，失败时抛出异常。
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
        logger.error(f"[chat] LLM 开场白失败: {e}")
        raise


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

    logger.info(
        f"[chat] conversation_history 组装完成: history_turns={len(recent)}, "
        f"assembled_messages={_serialize_messages_for_log(messages)}"
    )
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
        raw_text = resp.json()["choices"][0]["message"]["content"]
        logger.info(f"[chat] 模型返回文本(raw): {_clip_text(raw_text, 200)}")
        text = _clean_think(raw_text)
        logger.info(f"[chat] 模型返回文本(clean): {_clip_text(text, 200)}")
        ai_text, is_final = _extract_completion_flag(text)
        logger.info(
            f"[chat] 模型返回解析结果: ai_text={_clip_text(ai_text, 200)}, is_final={is_final}"
        )

        # 收尾语提前识别：若 AI 未打标记但语义与 closing_line 相近，视为结束
        closing_line = task_context.get("closing_line", "")
        if not is_final and _match_closing_line(ai_text, closing_line):
            logger.info(f"[chat] 收尾语匹配命中，is_final 提前置 True")
            is_final = True

        return ai_text, is_final
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.json().get("error", {}).get("message", e.response.text[:200])
        except Exception:
            detail = e.response.text[:200] if e.response.text else str(e)
        logger.error(f"[chat] LLM HTTP {e.response.status_code}: {detail}")
        raise RuntimeError(f"模型调用失败 (HTTP {e.response.status_code}): {detail}")
    except Exception as e:
        logger.error(f"[chat] LLM 回复失败: {e}")
        raise RuntimeError(f"模型调用失败: {str(e)[:200]}")


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
    返回 (ai_text, is_final)。失败时直接 raise 异常。
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
        logger.error(f"[chat] Plan A 收尾 LLM 失败: {e}")
        raise


# ============================================================
# 3. TTS 文本转语音（豆包 TTS 优先 → gTTS 降级）
# ============================================================
def text_to_speech(text: str) -> str:
    """
    将文本转为音频文件，保存到 TTS_DIR。
    策略：豆包 TTS V3 API（APP_ID + Token 优先 → 纯 API Key 备用 → gTTS 降级）。
    返回音频 URL（如 /uploads/tts/abc.mp3），失败返回空字符串。
    """
    os.makedirs(TTS_DIR, exist_ok=True)
    text_hash = hashlib.md5(text.encode()).hexdigest()[:12]
    req_id = str(uuid.uuid4())

    # 检查缓存（任一种方案命中均可复用）
    filename = f"{text_hash}.mp3"
    filepath = os.path.join(TTS_DIR, filename)
    if os.path.isfile(filepath):
        logger.info(f"[TTS] 缓存命中: {filepath}")
        return f"/uploads/tts/{filename}"

    audio_data: bytes | None = None

    # ---- 策略 1: 豆包 TTS V3（APP_ID + Token）----
    if DOUBAO_TTS_APP_ID and DOUBAO_TTS_TOKEN and not audio_data:
        try:
            headers = {
                "X-Api-App-Id": DOUBAO_TTS_APP_ID,
                "X-Api-Access-Key": DOUBAO_TTS_TOKEN,
                "X-Api-Resource-Id": DOUBAO_TTS_RESOURCE_ID,
                "X-Api-Request-Id": req_id,
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
                if resp.status_code != 200:
                    logger.warning(f"[TTS] HTTP {resp.status_code}: {resp.text[:300]}")
                    raise Exception(f"TTS API HTTP {resp.status_code}: {resp.text[:200]}")
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
            logger.info(f"[TTS] 豆包 TTS 成功")
        except Exception as e:
            logger.warning(f"[TTS] 豆包 Legacy 模式失败: {e}，降级 gTTS")

    # 保存豆包 TTS 生成的音频
    if audio_data:
        with open(filepath, "wb") as f:
            f.write(audio_data)
        logger.info(f"[TTS] 豆包生成成功: /uploads/tts/{filename}")
        return f"/uploads/tts/{filename}"

    # ---- 策略 2: gTTS 降级 ----
    try:
        tts = gTTS(text=text, lang="en", slow=False)
        tts.save(filepath)
        logger.info(f"[TTS] gTTS 生成成功: /uploads/tts/{filename}")
        return f"/uploads/tts/{filename}"
    except Exception as e:
        logger.warning(f"[TTS] gTTS 失败: {e}")

    logger.error(f"[TTS] 所有 TTS 方案均失败，返回空；前端将降级浏览器 SpeechSynthesis")
    return ""
