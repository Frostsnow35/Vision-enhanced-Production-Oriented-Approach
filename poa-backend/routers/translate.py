"""
单词翻译路由 —— 调用豆包 LLM 进行英汉词典翻译。
"""
import json
import logging

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from config import DOUBAO_API_KEY, DOUBAO_MODEL_ID, DOUBAO_BASE_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("translate_router")

router = APIRouter(prefix="/api", tags=["translate"])

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

TRANSLATE_SYSTEM_PROMPT = """\
你是英汉词典工具。你的唯一职责：把用户输入的英文单词翻译成中文，并给出简版音标。
【输出格式】严格 JSON，不要 markdown，不要加任何解释：
{"translation": "最常见的中文释义，15字以内", "phonetic": "简版音标，如 /ˈlæteɪ/"}
【约束】
- 只接受单个英文单词；如收到短语或句子，只翻译第一个核心词
- translation 用 15 字以内的最常见中文释义（一个或多个，用顿号分隔）
- phonetic 用简版音标格式
- 不知道该词时，translation 返回 "未收录"，phonetic 留空字符串"""


class TranslateRequest(BaseModel):
    word: str


class TranslateResponse(BaseModel):
    translation: str
    phonetic: str


def _clean_markdown_fence(text: str) -> str:
    """清洗 LLM 返回中可能包裹的 markdown 代码块标记（```json ... ```）。"""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```", 2)
        if len(parts) >= 2:
            cleaned = parts[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()
    return cleaned


@router.post("/translate", response_model=TranslateResponse)
async def translate_word(req: TranslateRequest):
    """
    调用豆包 LLM 将英文单词翻译为中文，并返回简版音标。
    成功返回 {translation, phonetic}；失败时返回 translation="（翻译失败）"，phonetic=""，HTTP 200。
    """
    word = req.word.strip()
    if not word:
        return TranslateResponse(translation="（翻译失败）", phonetic="")

    body = {
        "model": DOUBAO_MODEL_ID,
        "temperature": 0.1,
        "max_tokens": 80,
        "messages": [
            {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
            {"role": "user", "content": word},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()

        text = resp.json()["choices"][0]["message"]["content"]
        cleaned = _clean_markdown_fence(text)
        data = json.loads(cleaned)

        translation = str(data.get("translation", "")).strip()
        phonetic = str(data.get("phonetic", "")).strip()

        if not translation:
            translation = "（翻译失败）"

        logger.info(f"[translate] word={word!r} → translation={translation!r}, phonetic={phonetic!r}")
        return TranslateResponse(translation=translation, phonetic=phonetic)

    except Exception as e:
        logger.warning(f"[translate] 翻译失败 word={word!r}: {e}")
        return TranslateResponse(translation="（翻译失败）", phonetic="")
