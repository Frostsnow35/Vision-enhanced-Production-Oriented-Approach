"""
扫描两个Token + 资源ID组合，找出正确的ASR凭证配对
"""
import os
import uuid
import httpx

APP_ID = "6352558460"
TOKENS = {
    "tok1(-fF9U...)": "-fF9U2HMGkTza6Mi2lLn8LnHJnAfVy_W",
    "tok2(4kCi...)": "4kCi0u3uo3Y_OBTS8aK4xaYSbhwcrg9q",
}
RESOURCES = ["volc.seedasr.auc", "volc.bigasr.auc", "volc.seedasr.2.0.auc"]
SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
AUDIO_URL = "https://poa-backend-production-c371.up.railway.app/uploads/audio/a4277fc59171424ea14af1e859d9e7a4.wav"

body = {
    "user": {"uid": "poa_user"},
    "audio": {"format": "mp3", "url": AUDIO_URL},
    "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
}

with httpx.Client(timeout=20.0) as client:
    for tok_name, tok in TOKENS.items():
        for rid in RESOURCES:
            req_id = str(uuid.uuid4())
            headers = {
                "X-Api-App-Key": APP_ID,
                "X-Api-Access-Key": tok,
                "X-Api-Resource-Id": rid,
                "X-Api-Request-Id": req_id,
                "X-Api-Sequence": "-1",
                "Content-Type": "application/json",
            }
            try:
                r = client.post(SUBMIT_URL, headers=headers, json=body)
                sc = r.headers.get("X-Api-Status-Code", "")
                msg = r.headers.get("X-Api-Message", "")
                print(f"[{tok_name} {rid:24s}] -> HTTP {r.status_code} status={sc} msg={msg}")
            except Exception as e:
                print(f"[{tok_name} {rid:24s}] -> ERROR {e}")
