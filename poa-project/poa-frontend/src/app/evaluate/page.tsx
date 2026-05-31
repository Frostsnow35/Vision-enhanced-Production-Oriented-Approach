"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import * as echarts from "echarts";
import { BASE_URL } from "@/lib/api";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";

/* ============================================================
   类型 & 常量
   ============================================================ */
interface DimScore {
  attempt1: number;
  attempt2: number;
  change: number;
  explanation: string;
}

interface EvaluateData {
  dimension_scores: Record<string, DimScore>;
  overall_improvement: string;
}

interface ComparisonItem {
  dimension: string;
  attempt1_score: number;
  attempt2_score: number;
  change: string;
  comment: string;
}

interface TargetEvalItem {
  gap_label: string;
  improved: boolean;
  evidence: string;
  suggestion: string;
}

const DIM_LABELS: Record<string, string> = {
  "fluency": "流利度",
  "accuracy": "语法准确性",
  "pragmatics": "语用得体性",
  "complexity": "语言复杂度",
  "task_completion": "任务完成度",
  "vocabulary": "词汇适配性",
  "pronunciation_intonation": "发音与语调",
  "发音标准度": "发音标准度",
  "语法规范性": "语法规范性",
  "词汇适配性": "词汇适配性",
  "语言功能达成度": "语言功能达成度",
  "语用策略得体性": "语用策略得体性",
  "话语回合适配性": "话语回合适配性",
  "副语言匹配度": "副语言匹配度",
};

const MOCK_EVALUATE: EvaluateData = {
  dimension_scores: {
    fluency:     { attempt1: 2.5, attempt2: 3.5, change: 1.0, explanation: "语速更平稳，停顿减少了约 40%。" },
    accuracy:    { attempt1: 2.0, attempt2: 3.8, change: 1.8, explanation: "时态错误从 5 处降至 1 处，主谓一致基本正确。" },
    pragmatics:  { attempt1: 1.5, attempt2: 4.0, change: 2.5, explanation: "从祈使句转变为 'I'd like'/'Could I have'，礼貌意识显著提升。" },
    complexity:  { attempt1: 2.0, attempt2: 3.0, change: 1.0, explanation: "开始使用 because/if/when 从句，但仍有卡顿。" },
    task_completion: { attempt1: 3.0, attempt2: 4.0, change: 1.0, explanation: "第二次完成了全部交际要点。" },
    vocabulary:  { attempt1: 2.0, attempt2: 3.5, change: 1.5, explanation: "从 'big cup' 转变为 'large'/'oat milk' 等场景词汇。" },
    pronunciation_intonation: { attempt1: 3.0, attempt2: 3.5, change: 0.5, explanation: "疑问句升调改善，连读和弱读仍需练习。" },
  },
  overall_improvement: "七个维度均有提升，语用得体性进步最大（+2.5）。",
};

/* ============================================================
   将后端返回的 comparison 数组转换为 dimension_scores 格式
   ============================================================ */
function convertApiToEvaluateData(raw: any): EvaluateData | null {
  if (!raw || typeof raw !== "object") return null;

  // 已经是前端格式
  if (raw.dimension_scores && typeof raw.dimension_scores === "object") {
    const dims = raw.dimension_scores;
    if (Object.keys(dims).length > 0) {
      return {
        dimension_scores: dims,
        overall_improvement: raw.overall_improvement ?? "",
      };
    }
  }

  // 后端 /api/evaluate-compare 格式：{ comparison: [...] }
  if (Array.isArray(raw.comparison) && raw.comparison.length > 0) {
    const dims: Record<string, DimScore> = {};
    for (const item of raw.comparison as ComparisonItem[]) {
      if (!item.dimension) continue;
      dims[item.dimension] = {
        attempt1: item.attempt1_score ?? 0,
        attempt2: item.attempt2_score ?? 0,
        change: parseFloat(item.change ?? "0") || 0,
        explanation: item.comment ?? "",
      };
    }
    return { dimension_scores: dims, overall_improvement: "" };
  }

  return null;
}

/* ============================================================
   页面组件
   ============================================================ */
export default function EvaluatePage() {
  const router = useRouter();

  // ---- 初始化状态 ----
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);

  const [data, setData] = useState<EvaluateData | null>(null);
  const [targetEval, setTargetEval] = useState<TargetEvalItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 如果 sessionStorage 有标记（正常导航），直接加载评价数据
    if (isTaskSelectedInSession()) {
      loadEvaluationData();
      setHasHistory(false);
      setInitDone(true);
      return;
    }
    
    // 否则显示选择器（刷新/重新进入）
    const history = getScenarioHistory();
    setHasHistory(history.length > 0);
    setInitDone(true);
  }, []);

  const loadEvaluationData = async () => {
    try {
      let text1 = "";
      let text2 = "";
      let gaps: any[] = [];
      try {
        const raw1 = localStorage.getItem("diagnosis");
        if (raw1) {
          const d1 = JSON.parse(raw1);
          const gaps1 = Array.isArray(d1) ? d1 : d1?.gaps ?? [];
          gaps = gaps1.filter((g: any) => g?.label).map((g: any) => ({
            label: g.label,
            evidence_sentence: g.evidence_sentence ?? "",
            explanation: g.explanation ?? "",
          }));
          text1 = gaps1.map((g: any) => g?.evidence_sentence ?? "").filter(Boolean).join(" ");
        }
      } catch { /* ignore */ }
      try {
        const raw2 = localStorage.getItem("diagnosis2");
        if (raw2) {
          const d2 = JSON.parse(raw2);
          const gaps2 = Array.isArray(d2) ? d2 : d2?.gaps ?? [];
          text2 = gaps2.map((g: any) => g?.evidence_sentence ?? "").filter(Boolean).join(" ");
        }
      } catch { /* ignore */ }

      const res = await fetch(`${BASE_URL}/api/evaluate-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt1_text: text1 || "no text",
          attempt2_text: text2 || "no text",
          gaps,
        }),
      });

      if (res.ok) {
        const raw = await res.json();
        const converted = convertApiToEvaluateData(raw);
        if (converted && Object.keys(converted.dimension_scores).length > 0) {
          setData(converted);
        } else {
          setData(MOCK_EVALUATE);
        }
        if (Array.isArray(raw.target_evaluation) && raw.target_evaluation.length > 0) {
          setTargetEval(raw.target_evaluation);
        }
      } else {
        setData(MOCK_EVALUATE);
      }
    } catch {
      setData(MOCK_EVALUATE);
    } finally {
      setLoading(false);
      setInitDone(true);
    }
  };

  // 安全提取 dims
  const dims: string[] = data?.dimension_scores
    ? Object.keys(data.dimension_scores)
    : [];

  const sorted: string[] = dims.length > 0 && data
    ? [...dims].sort(
        (a, b) =>
          (data.dimension_scores[b]?.change ?? 0) -
          (data.dimension_scores[a]?.change ?? 0)
      )
    : [];

  // ---- 加载中 ----
  if (!initDone) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // ---- 有历史任务 → 显示选择器 ----
  if (hasHistory) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="w-full max-w-md px-4">
          <HistoryTaskSelector
            onSelected={(item: ScenarioHistoryItem) => {
              localStorage.setItem("currentTask", JSON.stringify(item));
              markTaskSelectedInSession();
              setHasHistory(false);
              loadEvaluationData();
            }}
          />
        </div>
      </div>
    );
  }

  // ---- 加载中 ----
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        正在加载双轨评价...
      </div>
    );
  }

  // ---- 无数据 ----
  if (!data || dims.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold text-card-foreground">暂无评价数据</h2>
          <p className="mt-2 text-sm text-muted-foreground">请先完成初次产出和二次产出练习</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/scenario")}>
            返回场景驱动
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          双轨评价报告
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          初次产出 vs 二次产出 — 七维度对比评估
        </p>
      </header>

      {data.overall_improvement ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold text-card-foreground">总体评价</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{data.overall_improvement}</p>
        </div>
      ) : null}

      <RadarChart data={data} dims={dims} />

      {/* ---- 靶向问题改善评估 ---- */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">靶向问题改善评估</h2>
        {targetEval.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            暂无靶向评估数据
          </div>
        ) : (
          targetEval.map((item, i) => (
            <div
              key={i}
              className={`rounded-xl border-2 bg-card p-5 shadow-sm space-y-3 ${
                item.improved
                  ? "border-green-500/40"
                  : "border-destructive/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {item.improved ? "✅" : "❌"}
                </span>
                <h3 className="text-sm font-semibold text-card-foreground">
                  {item.gap_label}
                </h3>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.improved
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {item.improved ? "已改善" : "未改善"}
                </span>
              </div>

              <div className="rounded-lg bg-muted/40 px-4 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {item.improved ? "改善证据" : "问题证据"}
                </p>
                <p className="mt-1 text-sm text-card-foreground">
                  {item.evidence}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                <span className="font-medium">建议：</span>
                {item.suggestion}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">逐维度分析</h2>
        {sorted.map((dim) => {
          const s = data.dimension_scores[dim];
          if (!s) return null;
          const label = DIM_LABELS[dim] ?? dim;
          const up = s.change > 0;
          const flat = s.change === 0;

          return (
            <div key={dim} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-card-foreground">{label}</h3>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    up
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                      : flat
                        ? "bg-muted text-muted-foreground"
                        : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {up ? "↑" : flat ? "→" : "↓"} {Math.abs(s.change).toFixed(1)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">初次产出</span>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${((s.attempt1 || 0) / 5) * 100}%` }} />
                    </div>
                    <span className="w-7 text-right font-medium tabular-nums text-primary dark:text-primary">
                      {(s.attempt1 ?? 0).toFixed(1)}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">二次产出</span>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${((s.attempt2 || 0) / 5) * 100}%` }} />
                    </div>
                    <span className="w-7 text-right font-medium tabular-nums text-accent dark:text-accent">
                      {(s.attempt2 ?? 0).toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{s.explanation || ""}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-6 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">查看从场景到评价的完整学习证据链</p>
        <Button size="lg" onClick={() => router.push("/report/1")}>
          查看完整学习证据链 →
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   双线雷达图（含完整空值保护）
   ============================================================ */
const FALLBACK_INDICATOR = [
  { name: "流利度", min: 1, max: 5 },
  { name: "语法", min: 1, max: 5 },
  { name: "语用", min: 1, max: 5 },
  { name: "复杂度", min: 1, max: 5 },
  { name: "任务完成", min: 1, max: 5 },
  { name: "词汇", min: 1, max: 5 },
  { name: "发音", min: 1, max: 5 },
];

function RadarChart({ data, dims }: { data: EvaluateData | null; dims: string[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    // 初始化或复用 chart 实例
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    // 安全构建 indicator 和 values
    const hasData = data && dims.length > 0;
    const indicator = hasData
      ? dims.map((d) => ({ name: DIM_LABELS[d] ?? d, min: 1, max: 5 }))
      : FALLBACK_INDICATOR;

    const scoreMap = data?.dimension_scores ?? {};

    const values1 = hasData
      ? dims.map((d) => scoreMap[d]?.attempt1 ?? 0)
      : FALLBACK_INDICATOR.map(() => 3);

    const values2 = hasData
      ? dims.map((d) => scoreMap[d]?.attempt2 ?? 0)
      : FALLBACK_INDICATOR.map(() => 3);

    chart.setOption(
      {
        tooltip: { trigger: "item" },
        legend: {
          bottom: 8,
          data: ["初次产出", "二次产出"],
          textStyle: { fontSize: 12, color: "#64748b" },
        },
        radar: {
          center: ["50%", "48%"],
          radius: "60%",
          min: 1,
          max: 5,
          indicator,
          axisName: { color: "#64748b", fontSize: 11 },
          splitArea: { areaStyle: { color: ["#f8fafc", "#f1f5f9"] } },
        },
        series: [
          {
            name: "初次产出",
            type: "radar",
            data: [{ value: values1, name: "初次产出" }],
            lineStyle: { color: "#3b82f6", width: 2 },
            itemStyle: { color: "#3b82f6" },
            areaStyle: { color: "rgba(59, 130, 246, 0.08)" },
            symbol: "circle",
            symbolSize: 5,
          },
          {
            name: "二次产出",
            type: "radar",
            data: [{ value: values2, name: "二次产出" }],
            lineStyle: { color: "#f97316", width: 2 },
            itemStyle: { color: "#f97316" },
            areaStyle: { color: "rgba(249, 115, 22, 0.08)" },
            symbol: "diamond",
            symbolSize: 6,
          },
        ],
      },
      { notMerge: true }
    );

    return () => {
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, [data, dims]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div ref={chartRef} style={{ width: "100%", height: 400 }} />
    </div>
  );
}
