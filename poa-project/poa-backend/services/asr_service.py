"""
ASR 服务 —— 使用 openai-whisper 的 base 模型进行语音转写。
模型只加载一次，全局复用。环境不支持时自动降级为空文本。
"""
import logging
import os
from typing import Optional

from config import ASR_ENABLED

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")

_whisper_model: Optional[object] = None
_whisper_available: Optional[bool] = None


def _check_whisper() -> bool:
    global _whisper_available
    if _whisper_available is not None:
        return _whisper_available
    if not ASR_ENABLED:
        logger.info("[ASR] ASR_ENABLED=false，跳过 Whisper 加载")
        _whisper_available = False
        return False
    try:
        import whisper
        _whisper_available = True
        return True
    except ImportError:
        logger.warning("[ASR] openai-whisper 未安装，ASR 功能不可用")
        _whisper_available = False
        return False


def _load_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    if not _check_whisper():
        return None
    import whisper
    logger.info("[ASR] 正在加载 Whisper base 模型...")
    _whisper_model = whisper.load_model("base")
    logger.info("[ASR] Whisper base 模型加载完成")
    return _whisper_model


def transcribe_audio(audio_path: str) -> str:
    text, _ = transcribe_audio_with_timestamps(audio_path)
    return text


def transcribe_audio_with_timestamps(audio_path: str) -> tuple:
    """
    @brief 转写音频并返回词级时间戳数据
    @param audio_path 音频文件路径
    @return (full_text: str, segments: list[dict])
            segments 每项: {"start": float, "end": float, "text": str, "confidence": float}
            若 Whisper 不可用或失败，返回 ("", [])
    """
    if not os.path.isfile(audio_path):
        logger.error(f"[ASR] 音频文件不存在: {audio_path}")
        return "", []

    if not _check_whisper():
        logger.warning("[ASR] Whisper 不可用，返回空文本")
        return "", []

    try:
        model = _load_model()
        if model is None:
            return "", []
        logger.info(f"[ASR] 开始转写(含时间戳): {audio_path}")
        result = model.transcribe(audio_path, word_timestamps=True)
        text = result["text"].strip()
        raw_segments = result.get("segments", [])

        # 提取词级数据为统一格式
        segments = []
        for seg in raw_segments:
            for w in seg.get("words", []):
                segments.append({
                    "start": w.get("start", 0),
                    "end": w.get("end", 0),
                    "text": w.get("word", "").strip(),
                    "confidence": w.get("probability", 0),
                })

        logger.info(f"[ASR] 转写结果: {text[:100]}... ({len(segments)} words)")
        return text, segments
    except Exception as e:
        logger.error(f"[ASR] 转写失败: {e}")
        return "", []
