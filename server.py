#!/usr/bin/env python3
"""口语视频录制评估 - 后端服务"""

import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import imageio_ffmpeg
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

EVALUATE_SCRIPT = Path(__file__).parent / "evaluate_video.py"


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/upload", methods=["POST"])
def upload():
    if "video" not in request.files:
        return jsonify({"error": "未收到视频文件"}), 400

    video_file = request.files["video"]
    if video_file.filename == "":
        return jsonify({"error": "文件名为空"}), 400

    filename = f"{uuid.uuid4().hex}.webm"
    webm_path = UPLOAD_DIR / filename
    video_file.save(str(webm_path))

    # Convert webm to mp4 (webm not supported by Doubao API)
    mp4_path = UPLOAD_DIR / f"{uuid.uuid4().hex}.mp4"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    conv = subprocess.run(
        [ffmpeg, "-y", "-i", str(webm_path), "-c:v", "libx264", "-c:a", "aac", str(mp4_path)],
        capture_output=True, text=True, timeout=120,
    )
    if conv.returncode != 0:
        return jsonify({"error": "视频格式转换失败", "detail": conv.stderr[-500:]}), 500

    model = request.form.get("model", "doubao-seed-2-0-mini-260215")
    reasoning = request.form.get("reasoning_effort", "minimal")

    # Remove proxy env vars that can break API connectivity
    env = os.environ.copy()
    for v in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        env.pop(v, None)

    try:
        result = subprocess.run(
            [
                sys.executable,
                str(EVALUATE_SCRIPT),
                str(mp4_path),
                "--output", "json",
                "--model", model,
                "--reasoning-effort", reasoning,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "评估超时（超过 600 秒）"}), 504

    if result.returncode != 0:
        detail = (result.stdout + result.stderr)[-800:]
        return jsonify({"error": "评估脚本执行失败", "detail": detail}), 500

    # Robust JSON extraction from stdout
    raw = result.stdout
    evaluation = None
    # Try last line first (most likely location when --output json)
    for line in reversed(raw.strip().split("\n")):
        try:
            evaluation = json.loads(line)
            break
        except json.JSONDecodeError:
            continue
    # Fallback: extract from markdown code block or outermost {}
    if evaluation is None:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if m:
            try:
                evaluation = json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
    if evaluation is None:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            try:
                evaluation = json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    if evaluation is None:
        return jsonify({"error": "评估结果解析失败", "raw": raw[-2000:]}), 500

    return jsonify(evaluation)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 口语视频评估服务启动: http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
