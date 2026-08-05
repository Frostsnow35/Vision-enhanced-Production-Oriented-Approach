"""
ASR 服务 — 火山引擎录音文件识别标准版（提交任务 + 轮询查询结果）。
这是唯一的语音转写通道，不保留任何本地 Whisper 或浏览器 Web Speech 降级。

鉴权方式（根据官方文档）：
  旧版控制台：X-Api-App-Key + X-Api-Access-Key
  新版控制台：X-Api-Key（单字段）
  优先使用新版方式（DOUBAO_ASR_API_KEY），回退旧版。
"""
import logging
import time
import uuid

import httpx

from config import (
    DOUBAO_ASR_APP_ID,
    DOUBAO_ASR_TOKEN,
    DOUBAO_ASR_API_KEY,
    DOUBAO_ASR_RESOURCE_ID,
    DOUBAO_ASR_SUBMIT_URL,
    DOUBAO_ASR_QUERY_URL,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")


def _build_asr_headers(req_id: str) -> dict:
    """
    构造火山引擎录音文件识别标准版的鉴权 Header。
    优先新版控制台鉴权（仅 X-Api-Key），回退旧版（X-Api-App-Key + X-Api-Access-Key）。
    注意：X-Api-Sequence 固定为 -1，官方文档明确要求提交和查询都带此字段。
    """
    headers = {
        "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
        "X-Api-Request-Id": req_id,
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
    }
    if DOUBAO_ASR_API_KEY:
        # 新版控制台：仅需 X-Api-Key
        headers["X-Api-Key"] = DOUBAO_ASR_API_KEY
        logger.info("[ASR] 使用新版鉴权 (X-Api-Key)")
    else:
        # 旧版控制台：X-Api-App-Key + X-Api-Access-Key
        headers["X-Api-App-Key"] = DOUBAO_ASR_APP_ID
        headers["X-Api-Access-Key"] = DOUBAO_ASR_TOKEN
        logger.info("[ASR] 使用旧版鉴权 (App-Key + Access-Key)")
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
    api_key = DOUBAO_ASR_API_KEY
    if not api_key and (not app_id or not token):
        logger.warning("[ASR] DOUBAO_ASR_API_KEY 或 DOUBAO_ASR_APP_ID/TOKEN 未配置，跳过")
        return ""

    req_id = str(uuid.uuid4())

    submit_body = {
        "user": {"uid": "poa_user"},
        "audio": {
            "format": audio_format,
            "url": audio_url,
            # 指定识别语言为英语，提升准确率（默认中英混合）
            "language": "en-US",
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            submit_headers = _build_asr_headers(req_id)
            logger.info(f"[ASR] 提交任务: format={audio_format}, url={audio_url[:120]}..., "
                        f"resource={DOUBAO_ASR_RESOURCE_ID}")
            submit_resp = client.post(
                DOUBAO_ASR_SUBMIT_URL,
                headers=submit_headers,
                json=submit_body,
            )
            submit_status = submit_resp.headers.get("X-Api-Status-Code", "")
            submit_message = submit_resp.headers.get("X-Api-Message", "")
            logid = submit_resp.headers.get("X-Tt-Logid", "")

            if submit_status != "20000000":
                logger.warning(
                    f"[ASR] 提交失败 status={submit_status} message={submit_message} "
                    f"logid={logid}"
                )
                return ""

            logger.info(f"[ASR] 提交成功 logid={logid}，开始轮询...")

            # 轮询查询结果
            query_body = {}
            query_headers = _build_asr_headers(req_id)
            deadline = time.time() + max_wait_sec

            while time.time() < deadline:
                time.sleep(1.5)
                try:
                    query_resp = client.post(DOUBAO_ASR_QUERY_URL, headers=query_headers, json=query_body)
                    query_status = query_resp.headers.get("X-Api-Status-Code", "")
                    query_message = query_resp.headers.get("X-Api-Message", "")
                    query_logid = query_resp.headers.get("X-Tt-Logid", "")

                    if query_status == "20000000":
                        data = query_resp.json()
                        text = data.get("result", {}).get("text", "").strip()
                        if text:
                            logger.info(f"[ASR] 转写完成 (logid={query_logid}): {text[:100]}")
                            return text
                        # 20000000 但文本为空 — 可能是静音或仍在处理
                        logger.info(f"[ASR] 查询成功但文本为空 (logid={query_logid})，继续等待...")
                        continue
                    elif query_status == "20000003":
                        logger.warning(f"[ASR] 静音音频 / 未检测到人声 (logid={query_logid})")
                        return ""
                    elif query_status == "45000151":
                        logger.warning(f"[ASR] 音频格式不正确 (logid={query_logid})")
                        return ""
                    elif query_status == "45000002":
                        logger.warning(f"[ASR] 空音频 (logid={query_logid})")
                        return ""
                    elif query_status in ("20000001", "20000002"):
                        continue  # 处理中
                    else:
                        logger.warning(
                            f"[ASR] 查询失败 status={query_status} message={query_message} "
                            f"logid={query_logid}"
                        )
                        return ""
                except Exception as e:
                    logger.warning(f"[ASR] 查询异常: {e}")
                    time.sleep(2.0)

    except Exception as e:
        logger.warning(f"[ASR] 调用失败: {e}")
        return ""

    logger.warning(f"[ASR] 轮询超时（{max_wait_sec}s）")
    return ""
