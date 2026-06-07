"""
ASR 服务 —— 使用 openai-whisper 的 base 模型进行语音转写。
whisper 不可用时自动降级。
"""
import logging
import os
import re
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")

_whisper_model: Optional[object] = None
_whisper_available: Optional[bool] = None

NO_VOICE_MARKER = "__NO_VOICE__"


def _load_model():
    """懒加载 Whisper 模型。不可用时返回 None。"""
    global _whisper_model, _whisper_available
    if _whisper_available is False:
        return None
    if _whisper_model is not None:
        return _whisper_model
    try:
        import whisper
        logger.info("[ASR] 加载 Whisper base 模型...")
        _whisper_model = whisper.load_model("base")
        _whisper_available = True
        logger.info("[ASR] Whisper 就绪")
        return _whisper_model
    except Exception as e:
        logger.error(f"[ASR] Whisper 不可用: {e}")
        _whisper_available = False
        return None


def transcribe_audio(audio_path: str) -> str:
    """
    转写音频为文本。
    - 成功返回文本
    - 文件不存在抛出 FileNotFoundError
    - 模型加载失败抛出 RuntimeError
    - 转写无内容返回 NO_VOICE_MARKER
    """
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")

    model = _load_model()
    if model is None:
        raise RuntimeError("Whisper 语音识别模型不可用，请检查服务端依赖")

    abs_path = os.path.abspath(audio_path)
    logger.info(f"[ASR] audio_path 原始: {audio_path}")
    logger.info(f"[ASR] audio_path 绝对路径: {abs_path}")
    logger.info(f"[ASR] 文件存在: {os.path.isfile(abs_path)}, 大小: {os.path.getsize(abs_path) if os.path.isfile(abs_path) else 'N/A'}")

    result = model.transcribe(str(abs_path))
    text = result["text"].strip()
    logger.info(f"[ASR] 结果: {text[:100]}")

    stripped = text.strip()
    if not stripped:
        return NO_VOICE_MARKER

    # 去掉 ASR 失败标记后无有效内容 → 视为空
    clean = stripped.lower()
    for m in ["[inaudible]", "[unk]", "[silence]", "<unk>"]:
        clean = clean.replace(m, "")
    if not clean.strip() or len(re.findall(r"[a-zA-Z0-9一-鿿]", clean)) == 0:
        return NO_VOICE_MARKER

    return text
