#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
POA 一键冒烟测试
================
一条命令跑通完整业务闭环：

    健康检查 → 图片识别/任务生成 → 初次产出诊断 → 二次产出 → 双轨评价 → 证据链报告

任何一步出现 500 / 超时 / 断连，立即标记 FAIL，最终以非零退出码结束，
方便部署后手动体检，或接入 CI 每次发布前自动跑。

用法：
    python smoke_test.py                       # 默认测前端域名（走反代，能暴露代理超时）
    python smoke_test.py --backend             # 直连后端（对照，排除前端反代因素）
    python smoke_test.py --base https://xxx    # 自定义目标地址
    python smoke_test.py --steps health,attempt1   # 只跑指定步骤

可选环境变量：
    SMOKE_BASE_URL   目标基础 URL（优先级：--base > --backend > SMOKE_BASE_URL > 默认前端）
"""

import argparse
import json
import os
import sys
import time

import requests

FRONTEND_URL = "https://glimpsay-poa-x.up.railway.app"
BACKEND_URL = "https://poa-backend-production-97b8.up.railway.app"

# 后端容器内相对路径，直接走 analyze，无需本地上传图片。
# 对应 /app/sample_images/cafe.jpg（Dockerfile 中 sample_images 已 COPY 进镜像）。
SAMPLE_IMAGE = "sample_images/cafe.jpg"

TIMEOUT_LONG = 180      # LLM 长耗时接口（与前端反代 180s 对齐）
TIMEOUT_SHORT = 30      # 快速接口
POLL_INTERVAL = 2       # 场景分析轮询间隔（秒）
POLL_MAX = 90           # 轮询上限 90 次 × 2s = 180s

# 初次产出（含语用/语法不足，便于诊断出 gaps）
ATTEMPT1_TEXT = (
    "[user]: Good morning, I want coffee. Give me muffin too. How much it cost?"
)
# 二次产出（改进后，更得体）
ATTEMPT2_TEXT = (
    "[user]: Good morning! I'd like a medium coffee and a muffin, please. "
    "Could you tell me how much that costs?"
)

ALL_STEPS = ["health", "analyze", "attempt1", "attempt2", "evaluate", "report"]


class Result:
    """单步执行结果。"""

    def __init__(self, name, ok, detail="", elapsed=0.0):
        self.name = name
        self.ok = ok
        self.detail = detail
        self.elapsed = elapsed

    def render(self):
        mark = "PASS" if self.ok else "FAIL"
        return f"[{mark}] {self.name:8s} ({self.elapsed:6.1f}s) {self.detail}"


def _get(url, timeout=TIMEOUT_SHORT):
    return requests.get(url, timeout=timeout)


def _post(url, payload, timeout=TIMEOUT_LONG):
    return requests.post(url, json=payload, timeout=timeout)


def _err(name, t0, e):
    """统一把 requests 异常转成 FAIL Result。"""
    return Result(name, False, f"连接失败 {type(e).__name__}: {e}", time.time() - t0)


def step_health(base, ctx):
    """探活后端并检查关键配置是否就绪。

    前端反代只覆盖 /api/*，/health 仅存在于后端，故前端域名 404 时自动回退直连后端。
    """
    t0 = time.time()
    candidates = [f"{base}/health"]
    if f"{base}/health" != f"{BACKEND_URL}/health":
        candidates.append(f"{BACKEND_URL}/health")

    last_err = ""
    for url in candidates:
        try:
            r = _get(url, timeout=TIMEOUT_SHORT)
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                continue
            d = r.json()
            ok = d.get("status") == "ok"
            detail = (
                f"url={url} status={d.get('status')} "
                f"api_key={d.get('api_key_configured')} asr={d.get('asr_configured')}"
            )
            return Result("health", ok, detail, time.time() - t0)
        except requests.exceptions.RequestException as e:
            last_err = f"{type(e).__name__}: {e}"

    return Result("health", False, f"健康检查失败 {last_err}", time.time() - t0)


def step_analyze(base, ctx):
    """触发场景分析并轮询结果，把 scenario_id / task_id / 评价标准写入 ctx。"""
    t0 = time.time()
    try:
        r = _post(f"{base}/api/scenario/analyze", {"image_path": SAMPLE_IMAGE}, timeout=TIMEOUT_SHORT)
        if r.status_code != 200:
            return Result("analyze", False, f"HTTP {r.status_code}: {r.text[:200]}", time.time() - t0)
        task_id = r.json().get("task_id")
        if not task_id:
            return Result("analyze", False, f"响应缺少 task_id: {r.text[:200]}", time.time() - t0)

        result = None
        for i in range(POLL_MAX):
            time.sleep(POLL_INTERVAL)
            try:
                s = _get(f"{base}/api/scenario/status/{task_id}", timeout=TIMEOUT_SHORT).json()
            except requests.exceptions.RequestException as e:
                return _err("analyze", t0, e)
            st = s.get("status")
            if st == "completed":
                result = s.get("result", {})
                break
            if st in ("failed", "not_found"):
                return Result("analyze", False, f"status={st}: {json.dumps(s, ensure_ascii=False)[:300]}", time.time() - t0)

        elapsed = time.time() - t0
        if not result:
            return Result("analyze", False, f"轮询 {POLL_MAX * POLL_INTERVAL}s 仍未完成", elapsed)

        scenario_id = result.get("scenario_id")
        task_id_val = result.get("task_id")
        ctx["scenario_id"] = scenario_id
        ctx["task_id"] = task_id_val
        ctx["evaluation_criteria"] = result.get("evaluation_criteria", "")
        ok = bool(scenario_id and task_id_val)
        detail = f"scenario_id={scenario_id} task_id={task_id_val} scene={result.get('scene_label', '')[:20]}"
        return Result("analyze", ok, detail, elapsed)
    except requests.exceptions.RequestException as e:
        return _err("analyze", t0, e)


def step_attempt1(base, ctx):
    """提交初次产出，AI 诊断不足，gaps 写入 ctx。"""
    t0 = time.time()
    try:
        payload = {
            "task_id": ctx.get("task_id"),
            "scenario_id": ctx.get("scenario_id"),
            "attempt_text": ATTEMPT1_TEXT,
            "attempt_number": 1,
            "audio_urls": [],
        }
        r = _post(f"{base}/api/attempt1/submit", payload, timeout=TIMEOUT_LONG)
        elapsed = time.time() - t0
        if r.status_code != 200:
            return Result("attempt1", False, f"HTTP {r.status_code}: {r.text[:300]}", elapsed)
        d = r.json()
        gaps = d.get("gaps", [])
        ctx["gaps"] = gaps
        ctx["attempt1_text"] = ATTEMPT1_TEXT
        detail = f"gaps={len(gaps)} high_freq_errors={len(d.get('high_freq_errors', []))}"
        if gaps:
            detail += f" | 首个 gap: {gaps[0].get('label', '')}"
        return Result("attempt1", True, detail, elapsed)
    except requests.exceptions.RequestException as e:
        return _err("attempt1", t0, e)


def step_attempt2(base, ctx):
    """提交二次产出，触发自动评价。"""
    t0 = time.time()
    try:
        payload = {
            "task_id": ctx.get("task_id"),
            "scenario_id": ctx.get("scenario_id"),
            "attempt_text": ATTEMPT2_TEXT,
            "attempt_number": 2,
            "audio_urls": [],
        }
        r = _post(f"{base}/api/attempt2/submit", payload, timeout=TIMEOUT_LONG)
        elapsed = time.time() - t0
        if r.status_code != 200:
            return Result("attempt2", False, f"HTTP {r.status_code}: {r.text[:300]}", elapsed)
        d = r.json()
        ctx["attempt2_text"] = ATTEMPT2_TEXT
        detail = f"gaps={len(d.get('gaps', []))}"
        return Result("attempt2", True, detail, elapsed)
    except requests.exceptions.RequestException as e:
        return _err("attempt2", t0, e)


def step_evaluate(base, ctx):
    """双轨评价：对比两次产出的七维表现。"""
    t0 = time.time()
    try:
        payload = {
            "task_id": ctx.get("task_id"),
            "attempt1_text": ctx.get("attempt1_text", ATTEMPT1_TEXT),
            "attempt2_text": ctx.get("attempt2_text", ATTEMPT2_TEXT),
            "gaps": ctx.get("gaps", []),
            "attempt1_scores": {},
            "evaluation_criteria": ctx.get("evaluation_criteria", ""),
        }
        r = _post(f"{base}/api/evaluate-compare", payload, timeout=TIMEOUT_LONG)
        elapsed = time.time() - t0
        if r.status_code != 200:
            return Result("evaluate", False, f"HTTP {r.status_code}: {r.text[:300]}", elapsed)
        d = r.json()
        dims = d.get("dimension_scores", {})
        detail = (
            f"维度数={len(dims)} 对比项={len(d.get('comparison', []))} "
            f"靶向评估={len(d.get('target_evaluation', []))}"
        )
        return Result("evaluate", True, detail, elapsed)
    except requests.exceptions.RequestException as e:
        return _err("evaluate", t0, e)


def step_report(base, ctx):
    """获取证据链报告。"""
    t0 = time.time()
    scenario_id = ctx.get("scenario_id")
    if not scenario_id:
        return Result("report", False, "缺少 scenario_id，无法获取报告", 0.0)
    try:
        r = _get(f"{base}/api/report/{scenario_id}", timeout=TIMEOUT_SHORT)
        elapsed = time.time() - t0
        if r.status_code != 200:
            return Result("report", False, f"HTTP {r.status_code}: {r.text[:300]}", elapsed)
        d = r.json()
        detail = f"顶层字段={list(d.keys())}"
        return Result("report", True, detail, elapsed)
    except requests.exceptions.RequestException as e:
        return _err("report", t0, e)


STEP_FUNCS = {
    "health": step_health,
    "analyze": step_analyze,
    "attempt1": step_attempt1,
    "attempt2": step_attempt2,
    "evaluate": step_evaluate,
    "report": step_report,
}

# 每个步骤依赖的前置步骤（前置 FAIL 则本步 SKIP）
DEPENDS = {
    "attempt1": "analyze",
    "attempt2": "analyze",
    "evaluate": "analyze",
    "report": "analyze",
}


def parse_args():
    p = argparse.ArgumentParser(description="POA 一键冒烟测试")
    p.add_argument("--base", default="", help="自定义目标基础 URL")
    p.add_argument("--backend", action="store_true", help="直连后端（默认测前端反代）")
    p.add_argument("--steps", default="", help="逗号分隔的步骤列表，默认全部")
    p.add_argument("--image", default=SAMPLE_IMAGE, help="场景图片路径（后端容器内相对路径）")
    return p.parse_args()


def main():
    args = parse_args()

    global SAMPLE_IMAGE
    SAMPLE_IMAGE = args.image

    if args.base:
        base = args.base.rstrip("/")
    elif args.backend:
        base = BACKEND_URL
    else:
        base = (os.environ.get("SMOKE_BASE_URL") or FRONTEND_URL).rstrip("/")

    if args.steps:
        steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    else:
        steps = ALL_STEPS

    print(f"冒烟测试目标: {base}")
    print(f"执行步骤: {', '.join(steps)}")
    print(f"场景图片: {SAMPLE_IMAGE}")
    print("-" * 60, flush=True)

    ctx = {}
    results = []        # 实际执行的步骤结果（PASS/FAIL）
    skipped = []        # 因前置失败/未知而跳过的步骤名
    ok_by_name = {}     # name -> bool

    for name in steps:
        if name not in STEP_FUNCS:
            skipped.append(name)
            print(f"[SKIP] {name} 未知步骤，忽略", flush=True)
            continue

        dep = DEPENDS.get(name)
        if dep and dep in ok_by_name and not ok_by_name[dep]:
            skipped.append(name)
            print(f"[SKIP] {name}（前置 {dep} 失败）", flush=True)
            continue

        r = STEP_FUNCS[name](base, ctx)
        ok_by_name[name] = r.ok
        results.append(r)
        print(r.render(), flush=True)

    print("-" * 60)
    passed = sum(1 for r in results if r.ok)
    failed = [r for r in results if not r.ok]
    tail = f"，{len(skipped)} 跳过" if skipped else ""
    print(f"结果: {passed}/{len(results)} 通过{tail}")

    if failed:
        print("失败步骤:")
        for r in failed:
            print(f"  - {r.name}: {r.detail}")
        sys.exit(1)

    print("全部通过，闭环可用")


if __name__ == "__main__":
    main()
