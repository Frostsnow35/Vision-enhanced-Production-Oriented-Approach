"""
火山引擎 TTS 连通性测试脚本
运行: cd poa-backend && python test_tts.py
"""
import os
import json
import uuid
import httpx
from dotenv import load_dotenv

load_dotenv()

APP_ID = os.getenv("DOUBAO_TTS_APP_ID", "")
TOKEN = os.getenv("DOUBAO_TTS_TOKEN", "")
RESOURCE_ID = os.getenv("DOUBAO_TTS_RESOURCE_ID", "seed-tts-2.0")
VOICE = os.getenv("DOUBAO_TTS_VOICE", "en_female_dacey_uranus_bigtts")
URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

print("=" * 60)
print("火山引擎 TTS V3 连通性测试")
print("=" * 60)
print(f"  APP_ID:       {APP_ID[:4]}***")
print(f"  TOKEN:        {TOKEN[:4]}***")
print(f"  RESOURCE_ID:  {RESOURCE_ID}")
print(f"  VOICE:        {VOICE}")
print(f"  URL:          {URL}")
print()

if not APP_ID or not TOKEN:
    print("[ERROR] 缺少 DOUBAO_TTS_APP_ID 或 DOUBAO_TTS_TOKEN")
    exit(1)

req_id = str(uuid.uuid4())
text = "Hello, this is a test."

headers = {
    "X-Api-App-Id": APP_ID,
    "X-Api-Access-Key": TOKEN,
    "X-Api-Resource-Id": RESOURCE_ID,
    "X-Api-Request-Id": req_id,
    "Content-Type": "application/json",
}
body = {
    "user": {"uid": "poa_test"},
    "namespace": "BidirectionalTTS",
    "req_params": {
        "text": text,
        "speaker": VOICE,
        "audio_params": {"format": "mp3", "sample_rate": 24000},
    },
}

print(f"[请求] req_id={req_id}, text='{text}'")
print(f"[请求] body={json.dumps(body, ensure_ascii=False)}")
print()

try:
    with httpx.Client(timeout=20.0) as client:
        resp = client.post(URL, headers=headers, json=body)
        print(f"[响应] HTTP {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"[ERROR] HTTP {resp.status_code}: {resp.text[:500]}")
            exit(1)
        
        # 显式处理 gzip 压缩
        raw_bytes = resp.content
        if resp.headers.get("content-encoding") == "gzip":
            print("[响应] 检测到 gzip 编码，正在解压...")
            import gzip
            raw_bytes = gzip.decompress(raw_bytes)
        raw_text = raw_bytes.decode("utf-8")
        
        lines = raw_text.strip().split("\n")
        print(f"[响应] 收到 {len(lines)} 行数据")
        
        audio_b64_parts = []
        errors = []
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            chunk = json.loads(line)
            code = chunk.get("code", -1)
            msg = chunk.get("message", "")
            print(f"[响应] 第{i+1}行: code={code}, msg={msg}")
            if code not in (0, 20000000):
                errors.append(f"code={code}: {msg}")
            data_val = chunk.get("data")
            if data_val:
                audio_b64_parts.append(data_val)
        
        if errors:
            print(f"\n[ERROR] API 返回错误: {'; '.join(errors)}")
            print("\n可能的原因:")
            print("  1. Voice ID 不存在或无权使用")
            print("  2. Resource ID 与 Voice 不匹配")
            print("  3. APP_ID 未开通语音合成权限")
            print("  4. TOKEN 已过期")
            print("\n建议: 到火山引擎控制台检查语音合成的可用音色列表")
            exit(1)
        
        if not audio_b64_parts:
            print("[ERROR] 未收到音频数据")
            exit(1)
        
        audio_b64 = "".join(audio_b64_parts)
        import base64
        audio_data = base64.b64decode(audio_b64)
        
        out_path = "test_tts_output.mp3"
        with open(out_path, "wb") as f:
            f.write(audio_data)
        
        print(f"\n[SUCCESS] 音频已保存到 {out_path} ({len(audio_data)} bytes)")
        print("请手动播放该文件验证音质。")

except httpx.HTTPStatusError as e:
    print(f"[ERROR] HTTP {e.response.status_code}: {e.response.text[:500]}")
    exit(1)
except Exception as e:
    print(f"[ERROR] {e}")
    exit(1)
