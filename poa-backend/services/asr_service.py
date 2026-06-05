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
    转写音频为文本。whisper 不可用时返回文件名哈希作为标识。
    """
    if not os.path.isfile(audio_path):
        logger.error(f"[ASR] 文件不存在: {audio_path}")
        return ""

    # whisper 不可用 → 返回占位文本让对话继续
    model = _load_model()
    if model is None:
        logger.warning("[ASR] Whisper 不可用，返回占位文本")
        return "[audio message]"

    try:
        logger.info(f"[ASR] 转写: {audio_path}")
        result = model.transcribe(audio_path)
        text = result["text"].strip()
        logger.info(f"[ASR] 结果: {text[:100]}")

        # 只拒绝完全空白的输出
        stripped = text.strip()
        if not stripped:
            return NO_VOICE_MARKER
        # 去掉失败标记后至少有一个字母/数字/中文
        clean = stripped.lower()
        for m in ["[inaudible]", "[unk]", "[silence]", "<unk>"]:
            clean = clean.replace(m, "")
        if not clean.strip() or len(re.findall(r"[a-zA-Z0-9一-鿿]", clean)) == 0:
            return NO_VOICE_MARKER

        return text
    except Exception as e:
        logger.error(f"[ASR] 转写失败: {e}")
        return ""
