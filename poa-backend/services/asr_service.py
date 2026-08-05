"""
ASR 服务 — 火山引擎流式语音识别（WebSocket 双向流式，二进制协议）。

主通道：流式 ASR（bigmodel 双向流式），前端实时推送 PCM 音频，后端代理转发。
降级通道（保留）：录音文件识别标准版（提交任务 + 轮询查询结果）。

协议要点（官方文档——豆包语音_流式语音识别WebSocket）：
- 建连 header 鉴权：新版控制台 X-Api-Key；旧版 X-Api-App-Key + X-Api-Access-Key
- resource_id 需带计费后缀：volc.seedasr.sauc.duration（2.0 小时版）/ .concurrent（2.0 并发版）
- 帧格式：4 字节 header + [4 字节 sequence] + 4 字节 payload_size + payload
  header[0] = (protocol_version << 4) | header_size        # 固定 0x11
  header[1] = (message_type << 4) | message_type_specific_flags
  header[2] = (serialization_method << 4) | compression_type
  header[3] = reserved（0x00）
- 首帧 FullClientRequest：JSON + GZIP，payload 为请求参数；flags=0b0001(含正sequence)
- 音频帧 AudioOnlyRequest：NO_SERIALIZATION + GZIP；flags=0b0001(正seq)；最后一包 flags=0b0011(负seq)
- 服务端 FullServerResponse(0b1001)：interim flags=0b0001(正seq)，final flags=0b0011(负seq)
  body: {"result": {"text": "...","utterances": [{"text":"...","definite":...,"start_time":...,"end_time":...}]}}
- 服务端 ErrorResponse(0b1111)：含 4 字节错误码 + 错误消息
"""
import asyncio
import gzip
import json
import logging
import struct
import time
import uuid
from typing import Optional, Tuple

import httpx
import websockets
from websockets.asyncio.client import ClientConnection

from config import (
    DOUBAO_ASR_APP_ID,
    DOUBAO_ASR_TOKEN,
    DOUBAO_ASR_API_KEY,
    DOUBAO_ASR_RESOURCE_ID,
    DOUBAO_ASR_SUBMIT_URL,
    DOUBAO_ASR_QUERY_URL,
    DOUBAO_ASR_STREAM_RESOURCE_ID,
    DOUBAO_ASR_STREAM_URL,
    DOUBAO_ASR_STREAM_TIMEOUT,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_service")

# ---- 火山流式 ASR 二进制协议常量 ----
PROTOCOL_VERSION = 0b0001
DEFAULT_HEADER_SIZE = 0b0001
FULL_CLIENT_REQUEST = 0b0001
AUDIO_ONLY_REQUEST = 0b0010
FULL_SERVER_RESPONSE = 0b1001
SERVER_ERROR_RESPONSE = 0b1111
NO_SEQUENCE = 0b0000
POS_SEQUENCE = 0b0001
NEG_WITH_SEQUENCE = 0b0011   # 最后一包，header 后 4 字节为负数 sequence
NO_SERIALIZATION = 0b0000
JSON_SERIALIZATION = 0b0001
GZIP_COMPRESSION = 0b0001
SERVER_RESPONSE_FINAL = 0b0011  # 服务端响应 flags=0b0011 表示最终结果


def _generate_header(message_type: int, flags: int, serial_method: int, compression: int) -> bytes:
    """生成 4 字节协议头。"""
    return bytes([
        (PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE,
        (message_type << 4) | flags,
        (serial_method << 4) | compression,
        0x00,
    ])


def _build_start_frame(params: dict, seq: int) -> bytes:
    """构建首帧 FullClientRequest（JSON + GZIP）。"""
    payload = gzip.compress(json.dumps(params, ensure_ascii=False).encode("utf-8"))
    header = _generate_header(FULL_CLIENT_REQUEST, POS_SEQUENCE, JSON_SERIALIZATION, GZIP_COMPRESSION)
    return header + struct.pack(">i", seq) + struct.pack(">I", len(payload)) + payload


def _build_audio_frame(pcm: bytes, seq: int, last: bool = False) -> bytes:
    """构建音频帧 AudioOnlyRequest。最后一包（last=True）sequence 取负。"""
    payload = gzip.compress(pcm) if pcm else b""
    flags = NEG_WITH_SEQUENCE if last else POS_SEQUENCE
    seq_value = -seq if last else seq
    header = _generate_header(AUDIO_ONLY_REQUEST, flags, NO_SERIALIZATION, GZIP_COMPRESSION)
    return header + struct.pack(">i", seq_value) + struct.pack(">I", len(payload)) + payload


def _parse_response(msg: bytes) -> dict:
    """
    解析服务端响应帧。官方协议中最终结果由 frame flags=0b0011 标记
    （JSON body 中无 is_final 字段）。
    @return {"message_type": int, "flags": int, "body": dict}
    """
    MAX_PAYLOAD_SIZE = 8 * 1024 * 1024  # 防御：拒绝超长 payload
    if len(msg) < 8:
        return {"message_type": 0, "flags": 0, "body": {}}
    message_type = msg[1] >> 4
    flags = msg[1] & 0x0F
    compression = msg[2] & 0x0F
    payload_size = int.from_bytes(msg[4:8], "big")
    if payload_size > MAX_PAYLOAD_SIZE:
        logger.warning(f"[ASR] 响应 payload 异常过大: {payload_size}，丢弃")
        return {"message_type": message_type, "flags": flags, "body": {}}
    payload = msg[8:8 + payload_size]
    if compression == GZIP_COMPRESSION and payload:
        try:
            payload = gzip.decompress(payload)
        except Exception:
            pass
    body = {}
    try:
        body = json.loads(payload.decode("utf-8"))
    except Exception:
        pass
    return {"message_type": message_type, "flags": flags, "body": body}


def _build_asr_headers(req_id: str, resource_id: str = "") -> dict:
    """
    构造火山引擎 ASR 鉴权 Header。
    优先新版控制台鉴权（仅 X-Api-Key），回退旧版（X-Api-App-Key + X-Api-Access-Key）。
    """
    rid = resource_id or DOUBAO_ASR_RESOURCE_ID
    headers = {
        "X-Api-Resource-Id": rid,
        "X-Api-Request-Id": req_id,
        "X-Api-Sequence": "-1",
        "X-Api-Connect-Id": str(uuid.uuid4()),
    }
    if DOUBAO_ASR_API_KEY:
        headers["X-Api-Key"] = DOUBAO_ASR_API_KEY
    else:
        headers["X-Api-App-Key"] = DOUBAO_ASR_APP_ID
        headers["X-Api-Access-Key"] = DOUBAO_ASR_TOKEN
    return headers


def _is_asr_configured() -> bool:
    """检查 ASR 是否已配置（有 API Key 或 App ID + Token）。"""
    return bool(DOUBAO_ASR_API_KEY or (DOUBAO_ASR_APP_ID and DOUBAO_ASR_TOKEN))


# ============================================================
# 主通道：流式 ASR（火山 bigmodel 双向流式）
# ============================================================


class VolcanoStreamASR:
    """
    火山引擎流式语音识别 WebSocket 客户端（双向流式，二进制协议）。

    用法:
        asr = VolcanoStreamASR()
        await asr.connect()
        await asr.start()
        await asr.send_audio(pcm_bytes)          # PCM 16kHz 16bit mono
        text, is_final = await asr.receive_once()  # 每条响应（边发边收）
        await asr.finish()                       # 发送结束帧（负 sequence 空包）
        await asr.close()
    """

    def __init__(self):
        self._ws: Optional[ClientConnection] = None
        self._req_id = str(uuid.uuid4())
        self._seq = 0

    async def connect(self) -> None:
        """建立与火山引擎流式 ASR 的 WebSocket 连接。"""
        if not _is_asr_configured():
            raise RuntimeError("ASR 未配置: 缺少 DOUBAO_ASR_API_KEY 或 DOUBAO_ASR_APP_ID/TOKEN")

        headers = _build_asr_headers(self._req_id, DOUBAO_ASR_STREAM_RESOURCE_ID)
        # websockets 库 additional_headers 接受 [(key, value), ...]
        extra_headers = list(headers.items())

        logger.info(
            f"[ASR-Stream] 连接火山 WebSocket: {DOUBAO_ASR_STREAM_URL} "
            f"resource={DOUBAO_ASR_STREAM_RESOURCE_ID}"
        )
        self._ws = await websockets.connect(
            DOUBAO_ASR_STREAM_URL,
            additional_headers=extra_headers,
            close_timeout=5,
            ping_interval=20,
        )
        logger.info("[ASR-Stream] WebSocket 已连接")

    async def start(self) -> None:
        """发送首帧 FullClientRequest（JSON + GZIP）。"""
        if not self._ws:
            raise RuntimeError("WebSocket 未连接，请先调用 connect()")

        # 双向流式(bigmodel)不支持 audio.language 字段，默认中英文混合识别
        config = {
            "user": {"uid": "poa_user", "platform": "web", "sdk_version": "1.0"},
            "audio": {
                "format": "pcm",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": True,
                "show_utterances": True,
            },
        }
        self._seq += 1
        frame = _build_start_frame(config, self._seq)
        await self._ws.send(frame)
        logger.info("[ASR-Stream] 已发送 FullClientRequest")

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """发送 PCM 音频帧（AudioOnlyRequest）。"""
        if not self._ws:
            raise RuntimeError("WebSocket 未连接")
        if not pcm_bytes:
            return
        self._seq += 1
        frame = _build_audio_frame(pcm_bytes, self._seq)
        await self._ws.send(frame)

    async def finish(self) -> None:
        """发送结束帧：负 sequence 的空音频包，触发服务端输出最终结果。"""
        if not self._ws:
            raise RuntimeError("WebSocket 未连接")
        self._seq += 1
        frame = _build_audio_frame(b"", self._seq, last=True)
        await self._ws.send(frame)
        logger.info("[ASR-Stream] 已发送结束帧（负包）")

    async def receive_once(self, timeout: float = 10.0) -> Optional[Tuple[str, bool]]:
        """
        读取一条火山响应。
        @return (text, is_final)；is_final 由服务端帧 flags==0b0011 判定（非 JSON body）；
                 超时返回 None；服务端错误时返回 ("", True)
        """
        if not self._ws:
            return None
        try:
            msg = await asyncio.wait_for(self._ws.recv(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("[ASR-Stream] 等待火山响应超时")
            return None
        except Exception as e:
            logger.warning(f"[ASR-Stream] 接收异常: {e}")
            return None

        if not isinstance(msg, bytes):
            return None

        parsed = _parse_response(msg)
        if parsed["message_type"] == SERVER_ERROR_RESPONSE:
            logger.warning(f"[ASR-Stream] 火山返回错误响应: {parsed['body']}")
            return ("", True)

        # 最终结果判定：官方协议中由服务器帧 flags=0b0011 标记（不含 JSON is_final 字段）
        is_final = (parsed["flags"] == SERVER_RESPONSE_FINAL)

        result = parsed["body"].get("result", {})
        text = (result.get("text") or "").strip()

        if not text:
            utterances = result.get("utterances", [])
            if utterances:
                text = " ".join(u.get("text", "") for u in utterances).strip()

        return (text, is_final)

    async def close(self) -> None:
        """关闭 WebSocket 连接。"""
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
            logger.info("[ASR-Stream] WebSocket 已关闭")


# ============================================================
# 降级通道：录音文件识别标准版（提交任务 + 轮询查询结果）
# ============================================================


def transcribe_with_doubao_standard(audio_url: str, audio_format: str = "mp3", max_wait_sec: int = 25) -> str:
    """
    使用火山引擎录音文件识别标准版进行语音转写（提交任务 + 轮询查询结果）。
    保留作为降级通道，主通道已切换为流式 ASR。
    @param audio_url  音频的公网可访问 URL
    @param audio_format  音频容器格式：wav / mp3 / ogg
    @param max_wait_sec  最大轮询等待秒数
    @return  转写文本，失败返回 ""
    """
    if not _is_asr_configured():
        logger.warning("[ASR] DOUBAO_ASR_API_KEY 或 DOUBAO_ASR_APP_ID/TOKEN 未配置，跳过")
        return ""

    req_id = str(uuid.uuid4())

    submit_body = {
        "user": {"uid": "poa_user"},
        "audio": {
            "format": audio_format,
            "url": audio_url,
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
                        continue
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
