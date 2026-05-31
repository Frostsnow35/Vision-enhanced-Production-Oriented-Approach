"""
ASR 服务 —— 使用 openai-whisper 的 base 模型进行语音转写。
模型只加载一次，全局复用。
"""
import logging
import os
import re
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")

# 全局缓存的 Whisper 模型实例
_whisper_model: Optional[object] = None

# 无效转写标记
NO_VOICE_MARKER = "__NO_VOICE__"


def _load_model():
    """懒加载 Whisper base 模型，全局只加载一次。"""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    import whisper

    logger.info("[ASR] 正在加载 Whisper base 模型...")
    _whisper_model = whisper.load_model("base")
    logger.info("[ASR] Whisper base 模型加载完成")
    return _whisper_model


def _is_valid_transcription(text: str) -> bool:
    """
    校验转写文本是否包含有效语音内容。
    只拒绝：纯空、纯空白、纯 ASR 失败标记。
    """
    stripped = text.strip()
    if not stripped:
        return False

    # 去掉 ASR 失败标记后，还有字母/数字/中文即可
    remaining = stripped.lower()
    for marker in ["[inaudible]", "[unk]", "[silence]", "<unk>"]:
        remaining = remaining.replace(marker, "")
    remaining = remaining.strip()
    if not remaining or len(re.findall(r"[a-zA-Z0-9一-鿿]", remaining)) == 0:
        return False

    return True


def transcribe_audio(audio_path: str) -> str:
    """
    转写音频文件为文本。
    - 成功返回识别文本
    - 文件不存在或转写失败返回空字符串
    - 转写结果无效（过短/乱码/无声）返回 NO_VOICE_MARKER
    """
    if not os.path.isfile(audio_path):
        logger.error(f"[ASR] 音频文件不存在: {audio_path}")
        return ""

    try:
        model = _load_model()
        logger.info(f"[ASR] 开始转写: {audio_path}")
        result = model.transcribe(audio_path)
        text = result["text"].strip()
        logger.info(f"[ASR] 转写结果: {text[:100]}")

        if not _is_valid_transcription(text):
            logger.warning(
                f"[ASR] 转写结果无效，返回 NO_VOICE — "
                f"text={text[:80]} len={len(text)}"
            )
            return NO_VOICE_MARKER

        return text
    except Exception as e:
        logger.error(f"[ASR] 转写失败: {e}")
        return ""
