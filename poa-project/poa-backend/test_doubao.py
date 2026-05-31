"""
测试豆包 Chat Completions API 连通性。

用法:
    # 先设置环境变量
    set ARK_API_KEY=ark-your-key-here       (PowerShell)
    export ARK_API_KEY=ark-your-key-here    (bash)

    # 运行测试
    python test_doubao.py

如果未设置环境变量，会自动读取 config.py 中的 DOUBAO_API_KEY。
"""
import json
import os
import sys
import time

import httpx

# ---- 配置 ----
BASE_URL = os.environ.get("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
API_KEY = os.environ.get("ARK_API_KEY") or os.environ.get("DOUBAO_API_KEY")
MODEL_ID = os.environ.get("DOUBAO_MODEL_ID", "doubao-seed-2-0-mini-260215")

# 如果环境变量未设置，尝试从 config.py 读取
if not API_KEY:
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from config import DOUBAO_API_KEY
        API_KEY = DOUBAO_API_KEY
    except ImportError:
        pass

CHAT_URL = f"{BASE_URL}/chat/completions"

# ---- 测试 ----

def main():
    print(f"Base URL : {BASE_URL}")
    print(f"Model    : {MODEL_ID}")
    print(f"API Key  : {API_KEY[:15]}..." if API_KEY else "API Key  : (MISSING)")
    print()

    if not API_KEY:
        print("错误: 未找到 API Key。请设置环境变量 ARK_API_KEY 或 DOUBAO_API_KEY。")
        sys.exit(1)

    body = {
        "model": MODEL_ID,
        "messages": [
            {"role": "user", "content": "Hello"},
        ],
        "max_tokens": 16,
    }

    print("Sending request...")
    t0 = time.time()

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )

        elapsed = (time.time() - t0) * 1000

        if resp.status_code == 200:
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            print(f"[OK] HTTP 200 ({elapsed:.0f}ms)")
            print(f"  Reply: {reply.encode('ascii', errors='replace').decode()}")
        else:
            print(f"[FAIL] HTTP {resp.status_code} ({elapsed:.0f}ms)")
            try:
                err = resp.json()
                print(f"  Error: {json.dumps(err, ensure_ascii=False, indent=2)}")
            except Exception:
                print(f"  Response: {resp.text[:300]}")

    except httpx.ConnectError:
        print(f"[FAIL] Connection refused — cannot reach {BASE_URL}")
        print("  Check network/proxy settings")
    except httpx.TimeoutException:
        print("[FAIL] Request timed out (>30s)")
    except Exception as e:
        print(f"[FAIL] Exception: {e}")


if __name__ == "__main__":
    main()
