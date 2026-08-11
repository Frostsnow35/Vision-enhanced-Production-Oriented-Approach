"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import * as echarts from "echarts";
import { BASE_URL } from "@/lib/api";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem, addJourneyEntry, type JourneyDimensionScore } from "@/lib/store";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";
import InlineLoadingHint from "@/components/InlineLoadingHint";
import TaskGate from "@/components/TaskGate";

/* ============================================================
   类型 & 常量
   ============================================================ */
interface DimScore {
  attempt1: number;
  attempt2: number;
  change: number;
  weight?: number;
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
  weight?: number;
  comment: string;
}

interface TargetEvalItem {
  gap_label: string;
  improved: boolean;
  evidence: string;
  suggestion: string;
}

/* ============================================================
   将后端返回的 comparison 数组转换为 dimension_scores 格式
   ============================================================ */
function convertApiToEvaluateData(raw: any): EvaluateData | null {
  if (!raw || typeof raw !== "object") return null;

  if (raw.dimension_scores && typeof raw.dimension_scores === "object") {
    const dims = raw.dimension_scores;
    if (Object.keys(dims).length > 0) {
      return {
        dimension_scores: dims,
        overall_improvement: raw.overall_improvement ?? "",
      };
    }
  }

  if (Array.isArray(raw.comparison) && raw.comparison.length > 0) {
    const dims: Record<string, DimScore> = {};
    for (const item of raw.comparison as ComparisonItem[]) {
      if (!item.dimension) continue;
      dims[item.dimension] = {
        attempt1: item.attempt1_score ?? 0,
        attempt2: item.attempt2_score ?? 0,
        change: parseFloat(item.change ?? "0") || 0,
        weight: item.weight,
        explanation: item.comment ?? "",
      };
    }
    return { dimension_scores: dims, overall_improvement: "" };
  }

  if (raw.dimension_scores && typeof raw.dimension_scores === "object") {
    const dims: Record<string, DimScore> = {};
    for (const [key, val] of Object.entries(raw.dimension_scores as Record<string, any>)) {
      dims[key] = {
        attempt1: val.attempt1 ?? 0,
        attempt2: val.attempt2 ?? 0,
        change: val.change ?? 0,
        weight: val.weight,
        explanation: val.comment ?? val.explanation ?? "",
      };
    }
    if (Object.keys(dims).length > 0) {
      return { dimension_scores: dims, overall_improvement: "" };
    }
  }

  return null;
}

/* ============================================================
   页面组件
   ============================================================ */
export default function EvaluatePage() {
  const router = useRouter();
  const t = useTranslations();

  // ---- DIM_LABELS (使用 t) ----
  const DIM_LABELS: Record<string, string> = useMemo(() => ({
    "发音标准度": t("dims.pronunciation"),
    "语法规范性": t("dims.grammar"),
    "词汇适配性": t("dims.vocabulary"),
    "语言功能达成度": t("dims.function"),
    "语用策略得体性": t("dims.pragmatics"),
    "话语回合适配性": t("dims.turn_taking"),
    "副语言匹配度": t("dims.paralanguage"),
  }), [t]);

  // ---- 初始化状态 ----
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);

  const [data, setData] = useState<EvaluateData | null>(null);
  const [targetEval, setTargetEval] = useState<TargetEvalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isTaskSelectedInSession()) {
      loadEvaluationData();
      setHasHistory(false);
      setInitDone(true);
      return;
    }
    const history = getScenarioHistory();
    setHasHistory(history.length > 0);
    setInitDone(true);
  }, []);

  const loadEvaluationData = async () => {
    try {
      let text1 = "";
      let text2 = "";
      let gaps: any[] = [];
      let attempt1_scores: Record<string, number> = {};
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
          if (d1.dimension_scores && typeof d1.dimension_scores === "object") {
            attempt1_scores = d1.dimension_scores;
          }
        }
      } catch { /* ignore */ }
      try {
        const convText = localStorage.getItem("conversationText2") || localStorage.getItem("conversationText");
        if (convText) text2 = convText;
      } catch { /* ignore */ }

      const currentTaskParsed = JSON.parse(localStorage.getItem("currentTask") || "{}");
      const taskId = currentTaskParsed.task_id || 0;
      const scenarioIdFromStorage: number | null = currentTaskParsed.scenarioId ?? null;
      if (scenarioIdFromStorage) setScenarioId(scenarioIdFromStorage);
      const evaluationCriteria: string = currentTaskParsed.evaluation_criteria || "";
      const res = await fetch(`${BASE_URL}/api/evaluate-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          attempt1_text: text1 || "no text",
          attempt2_text: text2 || "no text",
          audio1_paths: JSON.parse(localStorage.getItem("attempt1_audio_urls") || "[]"),
          audio2_paths: JSON.parse(localStorage.getItem("attempt2_audio_urls") || "[]"),
          gaps,
          attempt1_scores,
          evaluation_criteria: evaluationCriteria,
        }),
      });

      if (res.ok) {
        const raw = await res.json();
        const converted = convertApiToEvaluateData(raw);
        if (converted && Object.keys(converted.dimension_scores).length > 0) {
          setData(converted);
          try {
            const scores: Record<string, JourneyDimensionScore> = {};
            let total = 0, count = 0;
            for (const [k, v] of Object.entries(converted.dimension_scores)) {
              scores[k] = { attempt1: v.attempt1, attempt2: v.attempt2, change: v.change };
              total += v.attempt2; count++;
            }
            const avg = count > 0 ? total / count : 0;
            const scene = (() => {
              try {
                const ct = localStorage.getItem("currentTask");
                if (ct) {
                  const parsed = JSON.parse(ct);
                  return parsed?.scene_label || t("evaluate.scene_label");
                }
              } catch { /* ignore */ }
              return t("evaluate.scene_label");
            })();
            const taskTitle = (() => {
              try {
                const ct = localStorage.getItem("currentTask");
                if (ct) {
                  const parsed = JSON.parse(ct);
                  const goal = parsed?.goal || "";
                  return goal.length > 30 ? goal.slice(0, 30) + "..." : goal;
                }
              } catch { /* ignore */ }
              return t("evaluate.task_label");
            })();
            const imageUrl = (() => {
              try {
                const ct = localStorage.getItem("currentTask");
                if (ct) {
                  const parsed = JSON.parse(ct);
                  return parsed?.image_url || undefined;
                }
              } catch { /* ignore */ }
              return undefined;
            })();
            addJourneyEntry({
              sceneLabel: scene,
              taskTitle,
              imageUrl,
              completedAt: Date.now(),
              avgScore: Number(avg.toFixed(2)),
              dimensionScores: scores,
            });
          } catch (e) { console.warn("[evaluate] 写入 journey 失败:", e); }
        } else {
          setError(t("evaluate.error_empty"));
        }
        if (Array.isArray(raw.target_evaluation) && raw.target_evaluation.length > 0) {
          setTargetEval(raw.target_evaluation);
        }
      } else {
        setError(t("evaluate.error_unavailable"));
      }
    } catch {
      setError(t("evaluate.error_network"));
    } finally {
      setLoading(false);
      setInitDone(true);
    }
  };

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
        <div className="text-center text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  // ---- 有历史任务 → 显示选择器 ----
  if (hasHistory) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="w-full max-w-md px-4">
          <HistoryTaskSelector
            autoRedirectIfEmpty
            reloadOnSelect
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
      <div className="space-y-4 py-12">
        <InlineLoadingHint show message={t("evaluate.evaluating")} height="h-48" />
        <InlineLoadingHint show message={t("evaluate.analyzing")} height="h-32" />
      </div>
    );
  }

  // ---- 错误 ----
  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="card p-8 text-center space-y-4">
          <h2 className="text-lg font-semibold text-destructive">{t("evaluate.generate_failed")}</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => { setError(null); setLoading(true); loadEvaluationData(); }}>
            {t("common.retry_action")}
          </Button>
        </div>
      </div>
    );
  }

  // ---- 无数据 ----
  if (!data || dims.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="card p-8 text-center">
          <h2 className="text-lg font-semibold text-card-foreground">{t("evaluate.no_eval_data")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("evaluate.no_eval_hint")}</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/scenario")}>
            {t("common.back_to_scenario")}
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <TaskGate>
    <div className="mx-auto max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          {t("evaluate.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("evaluate.subtitle")}
        </p>
      </header>

      {data.overall_improvement ? (
        <div className="card p-5">
          <p className="text-sm font-semibold text-card-foreground">{t("evaluate.overall")}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{data.overall_improvement}</p>
        </div>
      ) : null}

      <RadarChart data={data} dims={dims} dimLabels={DIM_LABELS} />

      {/* ---- 靶向问题改善评估 ---- */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">{t("evaluate.targeted_title")}</h2>
        {targetEval.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-foreground">
            {t("evaluate.no_targeted")}
          </div>
        ) : (
          targetEval.map((item, i) => (
            <div
              key={i}
              className={`card p-5 space-y-3 ${
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
                  {item.improved ? t("evaluate.improved") : t("evaluate.not_improved")}
                </span>
              </div>

              <div className="rounded-lg bg-muted/40 px-4 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {item.improved ? t("evaluate.improvement_evidence") : t("evaluate.problem_evidence")}
                </p>
                <p className="mt-1 text-sm text-card-foreground">
                  {item.evidence}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{t("evaluate.suggestion_prefix")}</span>
                {item.suggestion}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">{t("evaluate.dim_analysis")}</h2>
        {sorted.map((dim) => {
          const s = data.dimension_scores[dim];
          if (!s) return null;
          const label = DIM_LABELS[dim] ?? dim;
          const up = s.change > 0;
          const flat = s.change === 0;

          return (
            <div key={dim} className="card p-5 space-y-2">
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
                  {up ? "↑" : flat ? "→" : "↓"} {Math.abs(s.change ?? 0).toFixed(1)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">{t("evaluate.attempt1")}</span>
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
                  <span className="text-muted-foreground">{t("evaluate.attempt2")}</span>
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

              <p className="text-xs text-muted-foreground">
                {s.explanation ? <ClickableEnglish text={s.explanation} /> : ""}
              </p>
            </div>
          );
        })}
      </div>

      <div className="card flex items-center justify-between px-6 py-4">
        <p className="text-sm text-muted-foreground">{t("evaluate.view_report_hint")}</p>
        <Button size="lg" onClick={() => router.push(`/report/${scenarioId}`)}>
          {t("evaluate.view_report_btn")}
        </Button>
      </div>
    </div>
    </TaskGate>
  );
}

/* ============================================================
   双线雷达图（含完整空值保护）
   ============================================================ */
function RadarChart({ data, dims, dimLabels }: { data: EvaluateData | null; dims: string[]; dimLabels: Record<string, string> }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const t = useTranslations();

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    const hasData = data && dims.length > 0;

    const FALLBACK_INDICATOR = [
      { name: t("evaluate.fallback_fluency"), min: 1, max: 5 },
      { name: t("evaluate.fallback_grammar"), min: 1, max: 5 },
      { name: t("evaluate.fallback_pragmatics"), min: 1, max: 5 },
      { name: t("evaluate.fallback_complexity"), min: 1, max: 5 },
      { name: t("evaluate.fallback_task_completion"), min: 1, max: 5 },
      { name: t("evaluate.fallback_vocabulary"), min: 1, max: 5 },
      { name: t("evaluate.fallback_pronunciation"), min: 1, max: 5 },
    ];

    const indicator = hasData
      ? dims.map((d) => ({ name: dimLabels[d] ?? d, min: 1, max: 5 }))
      : FALLBACK_INDICATOR;

    const scoreMap = data?.dimension_scores ?? {};

    const values1 = hasData
      ? dims.map((d) => scoreMap[d]?.attempt1 ?? 0)
      : FALLBACK_INDICATOR.map(() => 3);

    const values2 = hasData
      ? dims.map((d) => scoreMap[d]?.attempt2 ?? 0)
      : FALLBACK_INDICATOR.map(() => 3);

    const attempt1Label = t("evaluate.attempt1");
    const attempt2Label = t("evaluate.attempt2");

    chart.setOption(
      {
        tooltip: { trigger: "item" },
        legend: {
          bottom: 8,
          data: [attempt1Label, attempt2Label],
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
            name: attempt1Label,
            type: "radar",
            data: [{ value: values1, name: attempt1Label }],
            lineStyle: { color: "#3b82f6", width: 2 },
            itemStyle: { color: "#3b82f6" },
            areaStyle: { color: "rgba(59, 130, 246, 0.08)" },
            symbol: "circle",
            symbolSize: 5,
            label: {
              show: true,
              fontSize: 10,
              color: "#3b82f6",
              formatter: (p: any) => p.value?.toFixed(1) ?? "",
            },
          },
          {
            name: attempt2Label,
            type: "radar",
            data: [{ value: values2, name: attempt2Label }],
            lineStyle: { color: "#f97316", width: 2 },
            itemStyle: { color: "#f97316" },
            areaStyle: { color: "rgba(249, 115, 22, 0.08)" },
            symbol: "diamond",
            symbolSize: 6,
            label: {
              show: true,
              fontSize: 10,
              color: "#f97316",
              formatter: (p: any) => p.value?.toFixed(1) ?? "",
            },
          },
        ],
      },
      { notMerge: true }
    );

    return () => {
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, [data, dims, dimLabels, t]);

  return (
    <div className="card p-4">
      <div ref={chartRef} style={{ width: "100%", height: 400 }} />
    </div>
  );
}