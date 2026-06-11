"""
ASR 服务
策略：火山引擎大模型 Flash ASR（云端，毫秒级）→ openai-whisper（本地，需安装）→ 空文本降级
"""
import base64
import hashlib
import json
import logging
import os
import subprocess
import tempfile
import uuid
from typing import Optional

import httpx

from config import (
    ASR_ENABLED,
    DOUBAO_API_KEY,
    DOUBAO_ASR_APP_ID,
    DOUBAO_ASR_RESOURCE_ID,
    DOUBAO_ASR_TOKEN,
    DOUBAO_ASR_URL,
)

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


def _convert_to_wav_b64(audio_path: str) -> Optional[str]:
    """将任意音频文件转为 WAV 格式并 base64 编码，用于 Flash ASR。需要 ffmpeg。"""
    # 尝试用 ffmpeg 转码
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
            capture_output=True, timeout=15,
        )
        if result.returncode != 0 or not os.path.isfile(wav_path):
            logger.warning(f"[ASR] ffmpeg 转码失败: {result.stderr.decode()[:200]}")
            return None
        with open(wav_path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except FileNotFoundError:
        logger.warning("[ASR] ffmpeg 未安装，无法转码音频")
        return None
    except Exception as e:
        logger.warning(f"[ASR] 音频转码异常: {e}")
        return None
    finally:
        if os.path.isfile(wav_path):
            os.remove(wav_path)


def transcribe_with_doubao_flash(audio_path: str) -> str:
    """
    使用火山引擎大模型 Flash ASR 进行语音转写。
    鉴权策略：X-Api-Key 优先（复用 DOUBAO_API_KEY）→ X-Api-App-Id + X-Api-Access-Key 旧模式
    需要 ffmpeg 将 webm/opus 转为 wav。
    返回转写文本，失败返回空字符串。
    """
    # 检查鉴权凭据
    api_key = DOUBAO_API_KEY
    app_id = DOUBAO_ASR_APP_ID
    token = DOUBAO_ASR_TOKEN
    if not api_key and (not app_id or not token):
        logger.warning("[ASR] Flash ASR 未配置凭据，跳过")
        return ""

    # 转码音频
    audio_b64 = _convert_to_wav_b64(audio_path)
    if not audio_b64:
        return ""

    # 构建请求
    body = {
        "user": {"uid": "poa_user"},
        "audio": {
            "format": "wav",
            "data": audio_b64,
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    req_id = str(uuid.uuid4())

    # 策略 1: X-Api-Key 新模式
    if api_key:
        try:
            headers = {
                "X-Api-Key": api_key,
                "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
                "X-Api-Request-Id": req_id,
                "X-Api-Sequence": "-1",
                "Content-Type": "application/json",
            }
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(DOUBAO_ASR_URL, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()
                code = data.get("code", -1)
                if code not in (0, 20000000):
                    raise Exception(f"ASR error code={code}: {data.get('message', 'unknown')}")
                text = data.get("result", {}).get("text", "").strip()
                if text:
                    logger.info(f"[ASR] Flash (X-Api-Key) 结果: {text[:100]}")
                    return text
                raise Exception("Flash ASR returned empty text")
        except Exception as e:
            logger.warning(f"[ASR] Flash X-Api-Key 模式失败: {e}")

    # 策略 2: Legacy App-Id + Token 旧模式
    if app_id and token:
        try:
            headers = {
                "X-Api-App-Key": app_id,
                "X-Api-Access-Key": token,
                "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
                "X-Api-Request-Id": req_id,
                "Content-Type": "application/json",
            }
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(DOUBAO_ASR_URL, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()
                code = data.get("code", -1)
                if code not in (0, 20000000):
                    raise Exception(f"ASR error code={code}: {data.get('message', 'unknown')}")
                text = data.get("result", {}).get("text", "").strip()
                if text:
                    logger.info(f"[ASR] Flash (Legacy) 结果: {text[:100]}")
                    return text
                raise Exception("Flash ASR returned empty text")
        except Exception as e:
            logger.warning(f"[ASR] Flash Legacy 模式失败: {e}")

    logger.warning("[ASR] Flash ASR 所有鉴权模式均失败")
    return ""


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
