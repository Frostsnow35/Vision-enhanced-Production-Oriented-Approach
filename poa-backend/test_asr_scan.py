"""
扫描多种资源ID + 鉴权组合，快速定位已开通的服务
"""
import os
import uuid
import httpx

APP_ID = os.getenv("DOUBAO_ASR_APP_ID", "6352558460")
TOKEN = os.getenv("DOUBAO_ASR_TOKEN", "4kCi0u3uo3Y_OBTS8aK4xaYSbhwcrg9q")
SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
AUDIO_URL = "https://poa-backend-production-c371.up.railway.app/uploads/audio/a4277fc59171424ea14af1e859d9e7a4.wav"

body = {
    "user": {"uid": "poa_user"},
    "audio": {"format": "mp3", "url": AUDIO_URL},
    "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
}

combos = [
    ("AppId+Token", "volc.seedasr.auc", "app_token"),
    ("AppId+Token", "volc.bigasr.auc", "app_token"),
    ("AppId+Token", "volc.bigasr.auc_turbo", "app_token"),
    ("AppId+Token", "volc.seedasr.tts", "app_token"),
    ("X-Api-Key", "volc.seedasr.auc", "api_key"),
    ("X-Api-Key", "volc.bigasr.auc", "api_key"),
]

with httpx.Client(timeout=20.0) as client:
    for mode, rid, auth in combos:
        req_id = str(uuid.uuid4())
        headers = {
            "X-Api-Resource-Id": rid,
            "X-Api-Request-Id": req_id,
            "X-Api-Sequence": "-1",
            "Content-Type": "application/json",
        }
        if auth == "app_token":
            headers["X-Api-App-Key"] = APP_ID
            headers["X-Api-Access-Key"] = TOKEN
        else:
            headers["X-Api-Key"] = TOKEN
        try:
            r = client.post(SUBMIT_URL, headers=headers, json=body)
            sc = r.headers.get("X-Api-Status-Code", "")
            msg = r.headers.get("X-Api-Message", "")
            print(f"[{mode:13s}] {rid:28s} -> HTTP {r.status_code} status={sc} msg={msg}")
        except Exception as e:
            print(f"[{mode:13s}] {rid:28s} -> ERROR {e}")
