import requests, base64, os, json

API_KEY = os.getenv("ARK_API_KEY", "ark-97813ace-af3d-4995-a7bf-8f3e7afd0ab2-59639")
MODEL = "doubao-seed-2-0-mini-260428"
URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

with open("sample_images/cafe.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

payload = {
    "model": MODEL,
    "messages": [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": "请用 JSON 返回：{scene_label, scene_elements}"}
        ]
    }]
}

resp = requests.post(URL, headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}, json=payload, timeout=60)
print(resp.status_code)
print(json.dumps(resp.json(), ensure_ascii=False, indent=2))
