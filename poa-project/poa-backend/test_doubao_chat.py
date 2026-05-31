"""测试豆包 Chat API 连通性。用法: python test_doubao_chat.py"""
import os
import requests

API_KEY = os.environ.get("ARK_API_KEY") or "ark-97813ace-af3d-4995-a7bf-8f3e7afd0ab2-59639"
URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

body = {
    "model": "doubao-seed-2-0-mini-260428",
    "messages": [{"role": "user", "content": "Hello, just say 'API works!'"}],
    "max_tokens": 50,
}

try:
    resp = requests.post(
        URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )

    if resp.status_code == 200:
        data = resp.json()
        print("[OK] Call succeeded!")
        print(data["choices"][0]["message"]["content"])
    else:
        print(f"[FAIL] Status: {resp.status_code}")
        print(resp.text[:500])

except requests.exceptions.ConnectError:
    print("[FAIL] Connection refused — check network/proxy")
except requests.exceptions.Timeout:
    print("[FAIL] Timeout (>60s)")
except Exception as e:
    print(f"[FAIL] {e}")
