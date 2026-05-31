#!/usr/bin/env python3
"""
豆包 Chat Completions CLI —— 供主服务通过 subprocess 调用。

用法:
    python ai_scripts/doubao_chat.py --prompt "你是助手" --text "Hello"
    python ai_scripts/doubao_chat.py --prompt "分析图片" --image "data:image/jpeg;base64,..."
    python ai_scripts/doubao_chat.py --prompt "分析图片" --image-file "/path/to/image.jpg"

输出: JSON 字符串（LLM 返回的 content）
退出码: 0=成功, 1=失败
"""
import argparse
import base64
import json
import os
import sys
import time

import httpx

# ---- 配置 (可通过环境变量覆盖) ----
BASE_URL = os.environ.get("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
API_KEY = os.environ.get("DOUBAO_API_KEY") or os.environ.get("ARK_API_KEY", "")
MODEL_ID = os.environ.get("DOUBAO_MODEL_ID", "doubao-seed-2.0-mini-260428")
VISION_MODEL_ID = os.environ.get("DOUBAO_VISION_MODEL_ID", "doubao-1.5-vision-pro-250328")

CHAT_URL = f"{BASE_URL}/chat/completions"

# 如果 API_KEY 为空，尝试从 config 读取
if not API_KEY:
    try:
        _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, _project_root)
        from config import DOUBAO_API_KEY
        API_KEY = DOUBAO_API_KEY
    except Exception:
        pass


def _build_messages(prompt: str, text: str, image_data: str | None, image_file: str | None):
    """构建 messages 列表。如果提供了图片，使用 vision 格式。"""
    has_image = bool(image_data or image_file)

    if has_image:
        # 处理图片文件
        if image_file and os.path.isfile(image_file):
            ext = os.path.splitext(image_file)[-1].lower()
            mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                        ".png": "image/png", ".webp": "image/webp"}
            mime_type = mime_map.get(ext, "image/jpeg")
            with open(image_file, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            image_data = f"data:{mime_type};base64,{b64}"
        elif not image_data:
            image_data = ""

        content = []
        if prompt:
            content.append({"type": "text", "text": prompt})
        if image_data:
            content.append({"type": "image_url", "image_url": {"url": image_data}})
        if text:
            content.append({"type": "text", "text": text})
        return [{"role": "user", "content": content}]
    else:
        messages = []
        if prompt:
            messages.append({"role": "system", "content": prompt})
        messages.append({"role": "user", "content": text or "Hello"})
        return messages


def main():
    parser = argparse.ArgumentParser(description="豆包 Chat Completions CLI")
    parser.add_argument("--prompt", default="", help="系统提示词")
    parser.add_argument("--text", default="", help="用户消息文本")
    parser.add_argument("--image", default="", help="Base64 Data URL 图片")
    parser.add_argument("--image-file", default="", help="本地图片文件路径")
    parser.add_argument("--timeout", type=int, default=60, help="请求超时秒数")
    parser.add_argument("--model", default="", help="模型 ID (覆盖默认值)")
    parser.add_argument("--json", action="store_true", help="将 text 参数作为 JSON 消息列表")
    args = parser.parse_args()

    # 选择模型：有图片用 vision 模型，否则用文本模型
    has_image = bool(args.image or args.image_file)
    model = args.model or (VISION_MODEL_ID if has_image else MODEL_ID)

    # 处理 --json 模式：text 是完整的 messages JSON
    if args.json and args.text:
        try:
            messages = json.loads(args.text)
        except json.JSONDecodeError as e:
            print(f"Invalid JSON: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        messages = _build_messages(args.prompt, args.text, args.image, args.image_file)

    body = {"model": model, "messages": messages}

    # 发送请求
    try:
        t0 = time.time()
        with httpx.Client(timeout=float(args.timeout)) as client:
            resp = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        elapsed = (time.time() - t0) * 1000

        # 输出纯文本（供 subprocess 捕获）
        print(content.strip())

    except httpx.HTTPStatusError as e:
        print(f"HTTP {e.response.status_code}: {e.response.text[:300]}", file=sys.stderr)
        sys.exit(1)
    except httpx.ConnectError:
        print(f"Connection refused: {BASE_URL}", file=sys.stderr)
        sys.exit(1)
    except httpx.TimeoutException:
        print(f"Timeout after {args.timeout}s", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
