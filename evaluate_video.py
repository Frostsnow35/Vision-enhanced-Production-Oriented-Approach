#!/usr/bin/env python3
"""
英语口语练习视频评估脚本
使用豆包 (Doubao) Chat Completions API 对英语口语练习视频进行多维度评估。

依赖: 仅需系统自带 curl + Python 标准库，无需 pip 安装任何第三方库。

用法:
  python3 evaluate_video.py <video_path> [--model MODEL] [--output json|text] [--reasoning-effort low|medium|high]
  python3 evaluate_video.py ./my_speech.mp4
  python3 evaluate_video.py ./my_speech.mp4 --output json
  python3 evaluate_video.py ./my_speech.mp4 --reasoning-effort high
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ---------- 配置 ----------
ARK_API_KEY = os.environ.get("ARK_API_KEY", "ark-4efa4fd8-a676-4942-a58e-6b5b4eebd8dd-884b6")
ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seed-2-0-mini-260215"
VIDEO_MAX_SIZE_MB = 512
SUPPORTED_VIDEO_TYPES = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"}

HEADER_AUTH = ["-H", f"Authorization: Bearer {ARK_API_KEY}"]
CURL_TIMEOUT = 600


def _curl(args, timeout: int = CURL_TIMEOUT, capture: bool = True) -> subprocess.CompletedProcess:
    """Run curl with common flags. Returns CompletedProcess."""
    cmd = [
        "curl", "-s", "--max-time", str(timeout),
        "--connect-timeout", "30",
    ]
    if capture:
        cmd.append("--no-progress-meter")
    cmd.extend(args)
    result = subprocess.run(cmd, capture_output=capture, text=True)
    return result


def _check_response(result: subprocess.CompletedProcess, context: str) -> None:
    """Check curl result and exit on failure."""
    if result.returncode != 0:
        print(f"❌ {context}: curl 返回码 {result.returncode}")
        if result.stderr:
            print(f"   stderr: {result.stderr.strip()}")
        sys.exit(1)


def build_evaluation_prompt() -> str:
    return r"""你是一位专业的英语口语评估专家。请观看上传的英语口语练习视频，按照以下标准对视频中的英语口语表现进行严格、细致的评估。

## 评估标准

### 语言形式 (Language Form)
| 维度 | 3分 (合格) 锚点 | 5分 (优秀) 锚点 |
|------|---------------|---------------|
| 发音准确度 | 少量发音错误，不影响交际理解 | 发音清晰准确，符合母语者发音习惯 |
| 语法规范性 | 少量语法错误，不影响语义表达 | 语法使用规范，无结构性错误 |
| 词汇适配性 | 词汇使用基本匹配场景，无严重误用 | 词汇使用地道精准，适配交际场景与社交距离 |

### 语用交际 (Pragmatic Communication)
| 维度 | 3分 (合格) 锚点 | 5分 (优秀) 锚点 |
|------|---------------|---------------|
| 语言功能达成度 | 基本完成核心交际目标 | 完美完成交际目标，兼顾场景额外需求 |
| 语用策略得体性 | 表达基本得体，符合基础社交规范 | 表达地道得体，完全匹配场景语域特征 |
| 话语回合适配性 | 能回应对方话轮，无严重脱节 | 能精准承接话轮，主动推进交际进程 |
| 副语言匹配度 | 表情动作基本符合语境 | 表情动作自然流畅，与话语、语境高度匹配 |

## 输出要求

请严格按以下 JSON 格式输出评估结果（不要输出其他内容）：

{
  "overall_score": 0.0,
  "overall_comment": "总体评价（2-3句话概括表现和主要改进方向）",
  "dimensions": [
    {"category": "语言形式", "name": "发音准确度", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语言形式", "name": "语法规范性", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语言形式", "name": "词汇适配性", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语用交际", "name": "语言功能达成度", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语用交际", "name": "语用策略得体性", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语用交际", "name": "话语回合适配性", "score": 0.0, "comment": "具体评价和改进建议"},
    {"category": "语用交际", "name": "副语言匹配度", "score": 0.0, "comment": "具体评价和改进建议"}
  ]
}

注意：
- 每个维度评分为 1-5 分，精确到小数点后一位
- overall_score 为所有维度评分的加权平均（语言形式占40%，语用交际占60%）
- 评价必须具体，引用视频中的实际表现，用中文撰写
- 副语言匹配度关注眼神接触、面部表情、手势、身体语言等
- 请仔细观看视频内容后给出严谨的评估"""


def encode_video_to_data_url(file_path: str) -> str:
    """Read video file and return a data: URL for use with video_url."""
    fp = Path(file_path)
    suffix = fp.suffix.lower().lstrip(".")
    mime_type = f"video/{suffix}"
    with open(fp, "rb") as f:
        video_bytes = f.read()
    b64 = base64.b64encode(video_bytes).decode("ascii")
    return f"data:{mime_type};base64,{b64}"


def evaluate_video(video_path: str, model: str, reasoning_effort: str) -> dict:
    """Send video to Chat Completions API and return parsed evaluation."""
    fp = Path(video_path)
    if not fp.exists():
        print(f"❌ 错误: 文件不存在 - {video_path}")
        sys.exit(1)

    suffix = fp.suffix.lower()
    if suffix not in SUPPORTED_VIDEO_TYPES:
        print(f"⚠️  警告: 非标准视频格式 '{suffix}'，尝试继续...")

    file_size_mb = fp.stat().st_size / (1024 * 1024)
    if file_size_mb > VIDEO_MAX_SIZE_MB:
        print(f"❌ 错误: 视频 {file_size_mb:.1f}MB 超过上限 {VIDEO_MAX_SIZE_MB}MB")
        sys.exit(1)

    print(f"📤 正在编码视频 ({file_size_mb:.1f}MB)...")
    data_url = encode_video_to_data_url(video_path)
    print(f"   编码完成，data URL 长度: {len(data_url)} 字符")

    print(f"🤖 正在评估视频 (模型: {model}, 推理强度: {reasoning_effort})...")
    print("   (视频理解可能需要 30 秒到数分钟，请耐心等待)")

    payload = {
        "model": model,
        "reasoning_effort": reasoning_effort,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "video_url",
                        "video_url": {
                            "url": data_url,
                            "fps": 0.5,
                        },
                    },
                    {
                        "type": "text",
                        "text": build_evaluation_prompt(),
                    },
                ],
            },
        ],
    }

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as tmp:
        json.dump(payload, tmp, ensure_ascii=False)
        tmp_path = tmp.name

    try:
        start_time = time.time()
        result = _curl([
            *HEADER_AUTH,
            "-H", "Content-Type: application/json",
            "-d", f"@{tmp_path}",
            f"{ARK_BASE_URL}/chat/completions",
        ], timeout=600)
        elapsed = time.time() - start_time
    finally:
        os.unlink(tmp_path)

    _check_response(result, "评估请求失败")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"❌ 评估响应解析失败: {result.stdout[:500]}")
        sys.exit(1)

    if "error" in data:
        err_msg = data["error"].get("message", str(data["error"]))
        print(f"❌ 评估失败: {err_msg}")
        sys.exit(1)

    print(f"✅ 评估完成 (耗时 {elapsed:.0f}秒)")

    # Chat Completions API: extract from choices[0].message.content
    choices = data.get("choices", [])
    if not choices:
        print(f"❌ 未找到 choices。完整响应: {json.dumps(data, ensure_ascii=False, indent=2)[:2000]}")
        sys.exit(1)

    output_text = choices[0].get("message", {}).get("content", "")
    if not output_text:
        print(f"❌ 未找到 message.content。完整响应: {json.dumps(data, ensure_ascii=False, indent=2)[:2000]}")
        sys.exit(1)

    return parse_evaluation_result(output_text)


def parse_evaluation_result(raw_text: str) -> dict:
    """Extract JSON evaluation from model output."""
    # Direct parse
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    # Extract from markdown code block
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw_text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Find outermost JSON object
    m = re.search(r"\{[\s\S]*\}", raw_text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass

    print(f"⚠️  无法解析 JSON，原始输出:\n{raw_text[:2000]}")
    sys.exit(1)


def print_text_report(result: dict) -> None:
    """Pretty-print evaluation report."""
    print()
    print("=" * 60)
    print("         英语口语练习视频 — 评估报告")
    print("=" * 60)
    print()
    print(f"  📊 综合评分: {result['overall_score']:.1f} / 5.0")
    print(f"  💬 总体评价: {result['overall_comment']}")
    print()
    print("-" * 60)

    for dim in result.get("dimensions", []):
        stars = "★" * int(dim["score"]) + "☆" * (5 - int(dim["score"]))
        print(f"  [{dim['category']}] {dim['name']}")
        print(f"  分数: {dim['score']:.1f}/5.0  {stars}")
        print(f"  评语: {dim['comment']}")
        print()

    print("=" * 60)
    print("  各维度得分一览:")
    max_name_len = max(len(d["name"]) for d in result.get("dimensions", []))
    for dim in result.get("dimensions", []):
        bar = "█" * int(dim["score"] * 4) + "░" * (20 - int(dim["score"] * 4))
        print(f"  {dim['name']:<{max_name_len}}  {bar} {dim['score']:.1f}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="英语口语练习视频评估工具 (豆包 Chat Completions API — curl 模式)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 evaluate_video.py ./my_speech.mp4
  python3 evaluate_video.py ./my_speech.mp4 --output json
  python3 evaluate_video.py ./my_speech.mp4 --model doubao-seed-2-0-lite-260215
  python3 evaluate_video.py ./my_speech.mp4 --reasoning-effort high
        """,
    )
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"豆包模型 ID (默认: {DEFAULT_MODEL})")
    parser.add_argument("--output", choices=["text", "json"], default="text", help="输出格式")
    parser.add_argument("--api-key", default=None, help="火山方舟 API Key (也可用环境变量 ARK_API_KEY)")
    parser.add_argument(
        "--reasoning-effort", default="minimal", choices=["minimal", "low", "medium", "high"],
        help="推理深度 (默认: minimal)",
    )
    args = parser.parse_args()

    global ARK_API_KEY, HEADER_AUTH
    if args.api_key:
        ARK_API_KEY = args.api_key
        HEADER_AUTH = ["-H", f"Authorization: Bearer {ARK_API_KEY}"]

    result = evaluate_video(args.video_path, args.model, args.reasoning_effort)

    if args.output == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_text_report(result)


if __name__ == "__main__":
    main()
