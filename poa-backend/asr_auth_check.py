"""
ASR 鉴权快速验证脚本（独立诊断工具，不依赖业务代码）

用法:
    python asr_auth_check.py                                    # 使用 poa-backend/.env 中的凭证
    python asr_auth_check.py --api-key V8rSxHfRlxwojk2E55kT-uviYR3pls2I
    python asr_auth_check.py --app-id 6638062014 --token 7_7Z1GuZAtQXoMaDziegs0OBqBOh4H2E
    python asr_auth_check.py --api-key XXX --resource-id volc.bigasr.sauc.duration

输出: 握手成功 / HTTP 401(含 X-Tt-Logid) / 首帧响应内容
"""
import argparse
import asyncio
import gzip
import json
import struct
import sys
import uuid

import websockets
from websockets.exceptions import InvalidStatus

STREAM_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"


def build_headers(app_id: str, token: str, api_key: str, resource_id: str, req_id: str) -> dict:
    headers = {
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": req_id,
        "X-Api-Sequence": "-1",
        "X-Api-Connect-Id": str(uuid.uuid4()),
    }
    if api_key:
        headers["X-Api-Key"] = api_key
    else:
        headers["X-Api-App-Key"] = app_id
        headers["X-Api-Access-Key"] = token
    return headers


def build_start_frame() -> bytes:
    config = {
        "user": {"uid": "auth_check", "platform": "web"},
        "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1},
        "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
    }
    payload = gzip.compress(json.dumps(config, ensure_ascii=False).encode("utf-8"))
    header = bytes([0x11, 0x11, 0x11, 0x00])  # FULL_CLIENT_REQUEST + POS_SEQUENCE + JSON + GZIP
    return header + struct.pack(">i", 1) + struct.pack(">I", len(payload)) + payload


async def check(app_id: str, token: str, api_key: str, resource_id: str) -> None:
    req_id = str(uuid.uuid4())
    headers = build_headers(app_id, token, api_key, resource_id, req_id)
    auth_desc = f"X-Api-Key={api_key[:6]}***" if api_key else f"X-Api-App-Key={app_id} + X-Api-Access-Key={token[:6]}***"
    print(f"\n=== 测试: {auth_desc}")
    print(f"    resource_id = {resource_id}")
    print(f"    request_id  = {req_id}")

    try:
        ws = await websockets.connect(
            STREAM_URL, additional_headers=list(headers.items()),
            close_timeout=5, ping_interval=20,
        )
        print(">>> 握手成功（HTTP 200）")
        try:
            logid = ws.response.headers.get("X-Tt-Logid", "N/A")
            print(f"    X-Tt-Logid: {logid}")
        except Exception:
            pass

        # 发送首帧并读取一次响应
        await ws.send(build_start_frame())
        msg = await asyncio.wait_for(ws.recv(), timeout=10)
        if isinstance(msg, bytes):
            mt = msg[1] >> 4
            pl_size = int.from_bytes(msg[4:8], "big")
            payload = msg[8:8 + pl_size]
            try:
                payload = gzip.decompress(payload)
            except Exception:
                pass
            print(f"    首帧响应 message_type={mt}: {payload.decode('utf-8', errors='replace')}")
        else:
            print(f"    首帧响应(文本): {msg}")
        await ws.close()
        print(">>> 验证通过：凭证有效，服务可用")
    except InvalidStatus as e:
        print(f">>> 握手被拒: HTTP {e.response.status_code}")
        try:
            logid = dict(e.response.headers).get("X-Tt-Logid", "N/A")
            print(f"    X-Tt-Logid: {logid}")
        except Exception:
            pass
        # 尝试读取错误 body（可能包含服务端具体拒绝原因）
        body = getattr(e.response, "body", None)
        if body:
            try:
                print(f"    错误 body: {body.decode('utf-8', errors='replace')}")
            except Exception:
                print(f"    错误 body(bytes): {body!r}")
        print(">>> 结论: 服务端拒绝握手。HTTP 400 通常是 resource_id 未开通/不存在；"
              "\n        HTTP 401 通常是 Key/Token 无效或未实名认证。"
              "\n        请复制 X-Tt-Logid 到火山控制台工单查询具体原因。")
    except Exception as e:
        print(f">>> 连接异常: {type(e).__name__}: {e}")
    finally:
        sys.stdout.flush()


async def main():
    parser = argparse.ArgumentParser(description="火山流式 ASR 鉴权验证")
    parser.add_argument("--api-key", default="", help="新版控制台 API Key")
    parser.add_argument("--app-id", default="", help="旧版 APP ID")
    parser.add_argument("--token", default="", help="旧版 Access Token")
    parser.add_argument("--resource-id", default="volc.bigasr.sauc.duration")
    args = parser.parse_args()

    api_key = args.api_key
    app_id = args.app_id
    token = args.token

    # 未指定时尝试从 config 读取（加载 .env）
    if not (api_key or (app_id and token)):
        try:
            from config import (
                DOUBAO_ASR_API_KEY, DOUBAO_ASR_APP_ID, DOUBAO_ASR_TOKEN,
                DOUBAO_ASR_STREAM_RESOURCE_ID,
            )
            api_key = api_key or DOUBAO_ASR_API_KEY or ""
            app_id = app_id or DOUBAO_ASR_APP_ID or ""
            token = token or DOUBAO_ASR_TOKEN or ""
            if args.resource_id == "volc.bigasr.sauc.duration":
                args.resource_id = DOUBAO_ASR_STREAM_RESOURCE_ID or args.resource_id
        except ImportError:
            pass

    if api_key:
        await check(app_id, token, api_key, args.resource_id)
    if app_id and token:
        await check(app_id, token, "", args.resource_id)


if __name__ == "__main__":
    asyncio.run(main())
