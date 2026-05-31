"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePOA } from "@/lib/store";
import * as echarts from "echarts";

/* ============================================================
   常量
   ============================================================ */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/** 国创标准 7 维度 — 固定顺序，雷达图 indicator 与 series value 严格对齐 */
const RADAR_DIMENSIONS = [
  { key: "fluency",                  label: "流利度" },
  { key: "accuracy",                 label: "语法准确性" },
  { key: "pragmatics",               label: "语用得体性" },
  { key: "complexity",               label: "句式复杂度" },
  { key: "task_completion",          label: "任务完成度" },
  { key: "vocabulary",               label: "词汇丰富度" },
  { key: "pronunciation_intonation", label: "发音语调" },
] as const;

const RADAR_MAX = 10;

/* ============================================================
   类型
   ============================================================ */
interface DimCompare {
  attempt1: number;
  attempt2: number;
  comment: string;
  example: string;
}

interface TargetEval {
  label: string;
  attempt1_issue: string;
  attempt2_improvement: string;
  example: string;
}

interface EvalCompareResponse {
  dimension_scores: Record<string, DimCompare>;
  target_evaluation?: TargetEval[];
  problem_improved?: string;
  full_report?: string;
}

/* ============================================================
   辅助：安全收集产出文本
   ============================================================ */
function collectAttemptText(attempt: 1 | 2): string {
  // A) 优先从提交时存储的完整 ASR 转写文本读取
  const fullKey = attempt === 1 ? "attempt1_full_text" : "attempt2_full_text";
  try {
    const raw = localStorage.getItem(fullKey);
    if (raw && raw.trim()) return raw;
  } catch { /* ignore */ }

  // B) 回退：从 user_texts 数组拼接
  const textsKey = attempt === 1 ? "attempt1_user_texts" : "attempt2_user_texts";
  try {
    const raw = localStorage.getItem(textsKey);
    if (raw) {
      const texts = JSON.parse(raw);
      if (Array.isArray(texts)) {
        const joined = texts.filter(Boolean).join("\n");
        if (joined.trim()) return joined;
      }
    }
  } catch { /* ignore */ }

  // C) 回退：从 diagnosis/evaluation 的 evidence_sentence 提取
  try {
    const key = attempt === 1 ? "diagnosis" : "evaluation";
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      const gaps = Array.isArray(data) ? data : (data.gaps ?? []);
      const parts = gaps
        .map((g: { evidence_sentence?: string }) => g?.evidence_sentence || "")
        .filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
  } catch { /* ignore */ }

  return "";
}

/* ============================================================
   ECharts 双线雷达图
   ============================================================ */
function DualRadarChart({ data }: { data: EvalCompareResponse | null }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const buildOption = useCallback((): echarts.EChartsOption => {
    const indicator = RADAR_DIMENSIONS.map((d) => ({
      name: d.label,
      max: RADAR_MAX,
    }));

    const dimScores = data?.dimension_scores ?? {};
    const a1Values = RADAR_DIMENSIONS.map(
      (d) => dimScores[d.key]?.attempt1 ?? 0
    );
    const a2Values = RADAR_DIMENSIONS.map(
      (d) => dimScores[d.key]?.attempt2 ?? 0
    );

    return {
      legend: {
        data: ["初次产出", "二次产出"],
        bottom: 0,
        textStyle: { color: "#94a3b8", fontSize: 13 },
      },
      radar: {
        indicator,
        center: ["50%", "52%"],
        radius: "60%",
        axisName: {
          color: "#94a3b8",
          fontSize: 12,
          borderRadius: 3,
          padding: [2, 4],
        },
        splitArea: {
          areaStyle: {
            color: [
              "rgba(99, 102, 241, 0.03)",
              "rgba(99, 102, 241, 0.06)",
            ],
          },
        },
        splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.2)" } },
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.25)" } },
      },
      series: [
        {
          name: "初次产出",
          type: "radar",
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { color: "#3b82f6", width: 2 },
          areaStyle: { color: "rgba(59, 130, 246, 0.15)" },
          itemStyle: { color: "#3b82f6" },
          data: [{ value: a1Values, name: "初次产出" }],
        },
        {
          name: "二次产出",
          type: "radar",
          symbol: "diamond",
          symbolSize: 5,
          lineStyle: { color: "#f97316", width: 2 },
          areaStyle: { color: "rgba(249, 115, 22, 0.12)" },
          itemStyle: { color: "#f97316" },
          data: [{ value: a2Values, name: "二次产出" }],
        },
      ],
    };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;

    const existing = echarts.getInstanceByDom(chartRef.current);
    if (existing) existing.dispose();

    const instance = echarts.init(chartRef.current, undefined, {
      renderer: "canvas",
    });
    instanceRef.current = instance;
    instance.setOption(buildOption());

    const handleResize = () => instance.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      instance.dispose();
      instanceRef.current = null;
    };
  }, [buildOption]);

  return (
    <div
      ref={chartRef}
      className="w-full"
      style={{ height: 440, minHeight: 320 }}
    />
  );
}

/* ============================================================
   维度对比卡片
   ============================================================ */
function DimensionCompareList({ data }: { data: EvalCompareResponse }) {
  const dimScores = data.dimension_scores ?? {};

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-card-foreground">维度对比详情</h3>

      {RADAR_DIMENSIONS.map((dim) => {
        const d = dimScores[dim.key];
        const a1 = d?.attempt1 ?? 0;
        const a2 = d?.attempt2 ?? 0;
        const diff = a2 - a1;
        const isUp = diff > 0;
        const isDown = diff < 0;

        return (
          <div
            key={dim.key}
            className="rounded-lg border border-border bg-muted/30 p-4 space-y-3"
          >
            {/* 维度标题 + 双分数 */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-card-foreground">
                {dim.label}
              </span>
              <div className="flex items-center gap-2 text-sm tabular-nums">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                  初次 {a1}
                </span>
                <svg
                  className={`size-3 ${isUp ? "text-green-500" : isDown ? "text-destructive rotate-180" : "text-muted-foreground"}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                  二次 {a2}
                </span>
                {diff !== 0 && (
                  <span
                    className={`ml-1 text-xs font-bold tabular-nums ${
                      isUp ? "text-green-600" : "text-destructive"
                    }`}
                  >
                    {isUp ? "+" : ""}{diff.toFixed(1)}
                  </span>
                )}
              </div>
            </div>

            {/* 双轨进度条 */}
            <div className="space-y-1">
              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="bg-blue-500/60 transition-all duration-700"
                  style={{ width: `${(a1 / RADAR_MAX) * 100}%` }}
                />
              </div>
              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="bg-orange-500/70 transition-all duration-700"
                  style={{ width: `${(a2 / RADAR_MAX) * 100}%` }}
                />
              </div>
            </div>

            {/* 具体例子（引用块） */}
            {d?.example && d.example !== "无法从对话中提取证据" && (
              <blockquote className="rounded-lg border-l-3 border-primary/30 bg-primary/4 px-3 py-2">
                <p className="text-xs italic text-muted-foreground leading-relaxed">
                  {d.example}
                </p>
              </blockquote>
            )}

            {/* 详细评语 */}
            {a1 === 0 && a2 === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400 leading-relaxed">
                未检测到有效语音，该维度无法评估。
              </p>
            ) : d?.comment ? (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {d.comment}
              </p>
            ) : null}
          </div>
        );
      })}

      {/* 报告文本 */}
      {data.problem_improved && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h4 className="text-sm font-semibold text-card-foreground">
            问题改善情况
          </h4>
          <pre className="whitespace-pre-line text-sm text-muted-foreground">
            {data.problem_improved}
          </pre>
        </div>
      )}

      {data.full_report && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h4 className="text-sm font-semibold text-card-foreground">
            综合评价报告
          </h4>
          <pre className="whitespace-pre-line text-sm text-muted-foreground">
            {data.full_report}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   核心不足改善卡片（靶向评估）
   ============================================================ */
function TargetEvaluationCards({ items }: { items: TargetEval[] }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-card-foreground">
        核心不足改善情况
      </h3>

      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-primary/15 bg-primary/3 p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {i + 1}
            </span>
            <span className="text-sm font-semibold text-card-foreground">
              {item.label ?? `不足项 ${i + 1}`}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* 初次问题 */}
            <div className="rounded-md border border-destructive/15 bg-destructive/4 p-3 space-y-1">
              <p className="text-xs font-medium text-destructive">初次产出</p>
              <p className="text-sm text-card-foreground leading-relaxed">
                {item.attempt1_issue ?? "—"}
              </p>
            </div>

            {/* 二次改进 */}
            <div className="rounded-md border border-green-500/15 bg-green-50/40 dark:bg-green-950/10 p-3 space-y-1">
              <p className="text-xs font-medium text-green-600 dark:text-green-400">
                二次产出
              </p>
              <p className="text-sm text-card-foreground leading-relaxed">
                {item.attempt2_improvement ?? "—"}
              </p>
            </div>
          </div>

          {/* 具体例子 */}
          {item.example && (
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                具体例子
              </p>
              <p className="text-sm text-card-foreground leading-relaxed whitespace-pre-line">
                {item.example}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   页面组件
   ============================================================ */
export default function EvaluatePage() {
  const router = useRouter();
  const { attempt1Text, attempt2Text } = usePOA();

  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [result, setResult] = useState<EvalCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noData, setNoData] = useState(false);

  // 挂载时从 POA + localStorage 收集文本
  useEffect(() => {
    const t1 = attempt1Text?.trim() || collectAttemptText(1);
    const t2 = attempt2Text?.trim() || collectAttemptText(2);
    setText1(t1);
    setText2(t2);
    if (!t1 || !t2) setNoData(true);
  }, [attempt1Text, attempt2Text]);

  async function handleEvaluate() {
    if (!text1.trim() || !text2.trim()) {
      setError("请确保两次产出文本均已填写");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/evaluate-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt1_text: text1.trim(),
          attempt2_text: text2.trim(),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "Unknown");
        throw new Error(`${res.status}: ${detail}`);
      }
      const json = await res.json();

      if (json.error === "no_voice") {
        setError(json.message || "对比文本无效，请确保两次产出均包含有效语音内容");
        setLoading(false);
        return;
      }

      setResult(json as EvalCompareResponse);
      setNoData(false);
    } catch (err: any) {
      setError(err.message ?? "评价请求失败");
    } finally {
      setLoading(false);
    }
  }

  /* ============================================================
     Render
     ============================================================ */
  // 检测语音有效性
  const dimScores = result?.dimension_scores ?? {};
  const allA1Zero = Object.keys(dimScores).length > 0 &&
    Object.values(dimScores).every((d) => (d?.attempt1 ?? 1) === 0);
  const allA2Zero = Object.keys(dimScores).length > 0 &&
    Object.values(dimScores).every((d) => (d?.attempt2 ?? 1) === 0);

  return (
    <div className="space-y-6">
      {/* ---- 页面标题 ---- */}
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
          双轨评价
        </h1>
        <p className="mt-2 text-muted-foreground">
          对比两次产出，七维度雷达评分 · 蓝线 = 初次 · 橙线 = 二次
        </p>
      </div>

      {/* ---- 输入区域 ---- */}
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-4">
        <div>
          <label className="text-sm font-medium text-card-foreground">
            初次产出文本
          </label>
          <textarea
            value={text1}
            onChange={(e) => {
              setText1(e.target.value);
              if (e.target.value.trim()) setNoData(false);
            }}
            rows={3}
            placeholder="初次产出文本将自动从诊断数据中提取，也可手动编辑..."
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">
            二次产出文本
          </label>
          <textarea
            value={text2}
            onChange={(e) => {
              setText2(e.target.value);
              if (e.target.value.trim()) setNoData(false);
            }}
            rows={3}
            placeholder="二次产出文本将自动从诊断数据中提取，也可手动编辑..."
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleEvaluate}
            disabled={loading || !text1.trim() || !text2.trim()}
          >
            {loading ? "评价中..." : "开始双轨评价"}
          </Button>
          {noData && !result && (
            <span className="text-xs text-muted-foreground">
              请先完成两次产出
            </span>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* ---- 无数据提示 ---- */}
      {noData && !result && !loading && (
        <div className="rounded-lg border border-border bg-card p-8 shadow-sm text-center">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-muted mb-3">
            <svg
              className="size-6 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-muted-foreground font-medium">
            请先完成两次产出
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            前往「初次产出」和「二次产出」页面完成对话练习后，再返回查看双轨评价报告
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => router.push("/attempt1")}>
              初次产出
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/attempt2")}>
              二次产出
            </Button>
          </div>
        </div>
      )}

      {/* ---- 评价结果 ---- */}
      {result && (
        <div className="space-y-6">
          {/* 空语音提示 */}
          {allA1Zero && allA2Zero && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-center">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                初次产出和二次产出均无有效语音
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                所有维度评分为 0，无法进行对比评估。请确保录音环境安静并清晰表达。
              </p>
            </div>
          )}
          {allA1Zero && !allA2Zero && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-center">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                初次产出无有效语音
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                初次产出所有维度评分为 0。蓝色雷达线将显示在中心位置。
              </p>
            </div>
          )}
          {!allA1Zero && allA2Zero && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-center">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                二次产出无有效语音
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                二次产出所有维度评分为 0。橙色雷达线将显示在中心位置。
              </p>
            </div>
          )}

          {/* 双线雷达图 */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-card-foreground mb-2">
              七维度双轨对比
            </h2>
            <DualRadarChart data={result} />
          </div>

          {/* 靶向评估（核心不足改善） */}
          {result.target_evaluation &&
            result.target_evaluation.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                <TargetEvaluationCards items={result.target_evaluation} />
              </div>
            )}

          {/* 维度对比详情 */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <DimensionCompareList data={result} />
          </div>

          {/* 返回首页 */}
          <div className="text-center">
            <Button variant="outline" onClick={() => router.push("/")}>
              返回首页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
