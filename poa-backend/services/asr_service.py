"""
ASR 服务 —— 使用 openai-whisper 的 base 模型进行语音转写。
模型只加载一次，全局复用。
"""
import logging
import os
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")

# 全局缓存的 Whisper 模型实例
_whisper_model: Optional[object] = None


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


def transcribe_audio(audio_path: str) -> str:
    """
    转写音频文件为文本。
    成功返回识别文本，失败返回空字符串并记录错误日志。
    """
    if not os.path.isfile(audio_path):
        logger.error(f"[ASR] 音频文件不存在: {audio_path}")
        return ""

    try:
        model = _load_model()
        logger.info(f"[ASR] 开始转写: {audio_path}")
        result = model.transcribe(audio_path)
        text = result["text"].strip()
        logger.info(f"[ASR] 转写结果: {text[:100]}...")
        return text
    except Exception as e:
        logger.error(f"[ASR] 转写失败: {e}")
        return ""
