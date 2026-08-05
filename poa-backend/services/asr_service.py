"""
ASR 服务 — 火山引擎录音文件识别标准版（提交任务 + 轮询查询结果）。
这是唯一的语音转写通道，不保留任何本地 Whisper 或浏览器 Web Speech 降级。
"""
import logging
import time
import uuid

import httpx

from config import (
    DOUBAO_ASR_APP_ID,
    DOUBAO_ASR_TOKEN,
    DOUBAO_ASR_RESOURCE_ID,
    DOUBAO_ASR_SUBMIT_URL,
    DOUBAO_ASR_QUERY_URL,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")


def _build_asr_headers(req_id: str, with_sequence: bool = True) -> dict:
    """构造火山引擎录音文件识别标准版的鉴权 Header。"""
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


def transcribe_with_doubao_standard(audio_url: str, audio_format: str = "mp3", max_wait_sec: int = 25) -> str:
    """
    使用火山引擎录音文件识别标准版进行语音转写（提交任务 + 轮询查询结果）。
    @param audio_url  音频的公网可访问 URL
    @param audio_format  音频容器格式：wav / mp3 / ogg
    @param max_wait_sec  最大轮询等待秒数，默认 25（实测 8s 音频约 12s 出结果；
            上限受 Railway 60s Keep-Alive 限制，turn 总时长必须远小于 60s）
    @return  转写文本，失败返回 ""
    """
    app_id = DOUBAO_ASR_APP_ID
    token = DOUBAO_ASR_TOKEN
    if not app_id or not token:
        logger.warning("[ASR] DOUBAO_ASR_APP_ID/TOKEN 未配置，跳过")
        return ""

    req_id = str(uuid.uuid4())

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
            logger.info(f"[ASR] 提交任务: format={audio_format}, url={audio_url[:120]}...")
            submit_resp = client.post(
                DOUBAO_ASR_SUBMIT_URL,
                headers=_build_asr_headers(req_id, with_sequence=True),
                json=submit_body,
            )
            submit_status = submit_resp.headers.get("X-Api-Status-Code", "")
            if submit_status != "20000000":
                message = submit_resp.headers.get("X-Api-Message", submit_resp.text[:200])
                logger.warning(f"[ASR] 提交失败 status={submit_status}: {message}")
                return ""

            # 轮询查询结果
            query_body = {}
            query_headers = _build_asr_headers(req_id, with_sequence=False)
            deadline = time.time() + max_wait_sec

            while time.time() < deadline:
                time.sleep(1.5)
                try:
                    query_resp = client.post(DOUBAO_ASR_QUERY_URL, headers=query_headers, json=query_body)
                    query_status = query_resp.headers.get("X-Api-Status-Code", "")

                    if query_status == "20000000":
                        data = query_resp.json()
                        text = data.get("result", {}).get("text", "").strip()
                        if text:
                            logger.info(f"[ASR] 转写完成: {text[:100]}")
                            return text
                        continue  # 成功但文本为空，继续轮询
                    elif query_status in ("20000001", "20000002"):
                        continue  # 处理中
                    else:
                        message = query_resp.headers.get("X-Api-Message", query_resp.text[:200])
                        logger.warning(f"[ASR] 查询失败 status={query_status}: {message}")
                        return ""
                except Exception as e:
                    logger.warning(f"[ASR] 查询异常: {e}")
                    time.sleep(2.0)

    except Exception as e:
        logger.warning(f"[ASR] 调用失败: {e}")
        return ""

    logger.warning(f"[ASR] 轮询超时（{max_wait_sec}s）")
    return ""
