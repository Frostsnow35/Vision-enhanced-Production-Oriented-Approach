"""
ASR 服务
策略：火山引擎录音文件识别标准版（提交任务 + 查询结果）→ openai-whisper（本地，需安装）→ 空文本降级
"""
import logging
import os
import time
import uuid
from typing import Optional

import httpx

from config import (
    ASR_ENABLED,
    DOUBAO_ASR_APP_ID,
    DOUBAO_ASR_RESOURCE_ID,
    DOUBAO_ASR_TOKEN,
    DOUBAO_ASR_SUBMIT_URL,
    DOUBAO_ASR_QUERY_URL,
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


def _build_asr_headers(req_id: str, with_sequence: bool = True) -> dict:
    """构造火山引擎录音文件识别标准版的鉴权 Header。
    with_sequence: 提交任务时需要 X-Api-Sequence，查询结果时不需要。
    """
    headers = {
        "X-Api-App-Key": DOUBAO_ASR_APP_ID,
        "X-Api-Access-Key": DOUBAO_ASR_TOKEN,
        "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
        "X-Api-Request-Id": req_id,
        "Content-Type": "application/json",
    }
    if with_sequence:
        headers["X-Api-Sequence"] = "-1"
    return headers


def transcribe_with_doubao_standard(audio_url: str, audio_format: str = "mp3", max_wait_sec: int = 60) -> str:
    """
    使用火山引擎录音文件识别标准版进行语音转写（提交任务 + 轮询查询结果）。
    @brief 提交音频公网 URL 到服务端，轮询查询直到转写完成
    @param audio_url 音频的公网可访问 URL
    @param audio_format 音频容器格式：wav / mp3 / ogg（标准版不支持 webm）
    @param max_wait_sec 最大轮询等待秒数，默认 60
    @return 转写文本，失败返回空字符串
    """
    app_id = DOUBAO_ASR_APP_ID
    token = DOUBAO_ASR_TOKEN
    if not app_id or not token:
        logger.warning("[ASR] 标准版 ASR 未配置 DOUBAO_ASR_APP_ID/DOUBAO_ASR_TOKEN，跳过")
        return ""

    req_id = str(uuid.uuid4())

    # ---- 1. 提交任务 ----
    submit_body = {
        "user": {"uid": "poa_user"},
        "audio": {
            "format": audio_format,
            "url": audio_url,
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            logger.info(f"[ASR] 标准版提交: format={audio_format}, url={audio_url[:120]}...")
            submit_resp = client.post(
                DOUBAO_ASR_SUBMIT_URL,
                headers=_build_asr_headers(req_id, with_sequence=True),
                json=submit_body,
            )
            submit_status = submit_resp.headers.get("X-Api-Status-Code", "")
            if submit_status != "20000000":
                message = submit_resp.headers.get("X-Api-Message", submit_resp.text[:200])
                logger.warning(f"[ASR] 标准版提交失败 status={submit_status} message={message} audio_url={audio_url[:150]}")
                return ""

            # ---- 2. 轮询查询结果 ----
            query_body = {}
            query_headers = _build_asr_headers(req_id, with_sequence=False)
            deadline = time.time() + max_wait_sec
            while time.time() < deadline:
                time.sleep(1.5)
                try:
                    query_resp = client.post(
                        DOUBAO_ASR_QUERY_URL,
                        headers=query_headers,
                        json=query_body,
                    )
                    query_status = query_resp.headers.get("X-Api-Status-Code", "")
                    if query_status == "20000000":
                        data = query_resp.json()
                        text = data.get("result", {}).get("text", "").strip()
                        if text:
                            logger.info(f"[ASR] 标准版转写结果: {text[:100]}")
                            return text
                        # 成功但文本为空，可能仍在处理
                        continue
                    elif query_status in ("20000001", "20000002"):
                        # 正在处理 / 任务在队列中
                        continue
                    else:
                        message = query_resp.headers.get("X-Api-Message", query_resp.text[:200])
                        logger.warning(f"[ASR] 标准版查询失败 status={query_status}: {message}")
                        return ""
                except Exception as e:
                    logger.warning(f"[ASR] 标准版查询异常: {e}")
                    time.sleep(2.0)
    except Exception as e:
        logger.warning(f"[ASR] 标准版 ASR 失败: {e}")
        return ""

    logger.warning(f"[ASR] 标准版 ASR 轮询超时（{max_wait_sec}s）")
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
