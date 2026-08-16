"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";
import TaskGate from "@/components/TaskGate";
import {
  getScenarioHistory,
  isTaskSelectedInSession,
  markTaskSelectedInSession,
  type ScenarioHistoryItem,
} from "@/lib/store";
import { BASE_URL } from "@/lib/api";
import { pickTranslation, pickLocaleField } from "@/lib/locale-utils";

/* ============================================================
   类型定义
   ============================================================ */
interface GapItem {
  label: string;
  evidence_sentence: string | null;
  explanation: string | null;
  reference_expression?: string | null;
  translations?: Record<string, string>;
  label_en?: string;
  explanation_en?: string;
}

interface HighFreqError {
  phrase: string;
  occurrence: number;
  suggestion: string;
  suggestion_en?: string;
}

interface DimensionScore {
  score: number;
  label: string;
}

/* ============================================================
   骨架屏组件
   ============================================================ */
function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-6 shadow-sm animate-pulse ${className}`}>
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-full bg-muted" />
        <div className="h-5 w-3/4 rounded bg-muted" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full rounded bg-muted/60" />
        <div className="h-4 w-5/6 rounded bg-muted/60" />
      </div>
      <div className="mt-3 h-3 w-1/2 rounded bg-muted/40" />
    </div>
  );
}

/* ============================================================
   页面组件
   ============================================================ */
export default function DiagnosisPage() {
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const funTips: string[] = Array.isArray(t.raw("diagnosis.fun_tips")) ? t.raw("diagnosis.fun_tips") : [];

  // 维度名称本地化映射（后端返回中文维度名）
  const dimLabel = (key: string) => {
    const map: Record<string, string> = {
      "语言能力": t("dims.linguistic"),
      "话语能力": t("dims.discourse"),
      "行动能力": t("dims.actional"),
      "社会文化能力": t("dims.sociocultural"),
      "策略能力": t("dims.strategic"),
    };
    return map[key] ?? key;
  };

  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [gaps, setGaps] = useState<GapItem[] | null>(null);
  const [highFreqErrors, setHighFreqErrors] = useState<HighFreqError[]>([]);
  const [localDiagnosis, setLocalDiagnosis] = useState<ScenarioHistoryItem | null>(null);
  const [dimensionScores, setDimensionScores] = useState<Record<string, number> | null>(null);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const taskRef = useRef<ScenarioHistoryItem | null>(null);

  // 轮换提示词
  useEffect(() => {
    const t = setInterval(() => setTipIndex((i) => (i + 1) % funTips.length), 2000);
    return () => clearInterval(t);
  }, [funTips.length]);

  useEffect(() => {
    let hasData = false;
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const parsed = JSON.parse(raw);
        // 兼容三种格式：数组 / {gaps: []} / {gaps: [], high_freq_errors: []}
        const gapList: GapItem[] = Array.isArray(parsed)
          ? parsed
          : (parsed?.gaps ?? []);
        const hfList: HighFreqError[] = Array.isArray(parsed?.high_freq_errors)
          ? parsed.high_freq_errors
          : [];
        setGaps(gapList);
        setHighFreqErrors(hfList);
        hasData = true;
      }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem("currentTask");
      if (raw) { taskRef.current = JSON.parse(raw); setLocalDiagnosis(taskRef.current); hasData = true; }
    } catch { /* ignore */ }

    if (isTaskSelectedInSession() && hasData) {
      setHasHistory(false);
      setInitDone(true);
      return;
    }

    const history = getScenarioHistory();
    setHasHistory(history.length > 0);
    setInitDone(true);
  }, []);

  // 五维评分异步加载
  const fetchDimensionScores = useCallback(async (attemptId: number) => {
    setScoresLoading(true);
    try {
      const body = { attempt_id: attemptId };
      const rawBody = localStorage.getItem("attempt1_submit_body");
      if (rawBody) {
        const parsed = JSON.parse(rawBody);
        Object.assign(body, parsed);
      }
      const res = await fetch(`${BASE_URL}/api/attempt1/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.dimension_scores) {
          setDimensionScores(data.dimension_scores);
          // 回写到 diagnosis localStorage，避免evaluate页因读不到分数而重新调用LLM得到不一致的结果
          try {
            const raw = localStorage.getItem("diagnosis");
            if (raw) {
              const stored = JSON.parse(raw);
              if (Array.isArray(stored)) {
                localStorage.setItem("diagnosis", JSON.stringify({ gaps: stored, dimension_scores: data.dimension_scores }));
              } else {
                stored.dimension_scores = data.dimension_scores;
                localStorage.setItem("diagnosis", JSON.stringify(stored));
              }
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    finally { setScoresLoading(false); }
  }, []);

  // 诊断数据就绪后自动触发评分加载
  useEffect(() => {
    if (gaps && gaps.length > 0 && initDone && !hasHistory) {
      const attemptIdStr = localStorage.getItem("attempt1_id");
      if (attemptIdStr) {
        fetchDimensionScores(Number(attemptIdStr));
      }
    }
  }, [gaps, initDone, hasHistory, fetchDimensionScores]);

  // ---- 加载中（骨架屏 + 轮换提示词）----
  if (!initDone) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
            {t("diagnosis.diagnosing")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground transition-opacity duration-500">
            {funTips[tipIndex]}
          </p>
        </div>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
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
              markTaskSelectedInSession();
              localStorage.setItem("currentTask", JSON.stringify(item));
              setHasHistory(false);
              const raw = localStorage.getItem("diagnosis");
              if (raw) {
                try {
                  const data = JSON.parse(raw);
                  const gapList: GapItem[] = Array.isArray(data) ? data : data.gaps ?? [];
                  setGaps(gapList);
                } catch {
                  setGaps([]);
                }
              } else {
                setGaps([]);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // ---- 无诊断数据 ----
  if (!gaps || gaps.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-card-foreground">
          {t("diagnosis.diagnosis_done")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("diagnosis.no_gaps")}
        </p>
        <Button
          className="mt-6"
          onClick={() => router.push("/facilitate")}
        >
          {t("diagnosis.enter_facilitate")}
        </Button>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <TaskGate>
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- 页面标题 ---- */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          {t("diagnosis.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("diagnosis.summary", { count: gaps.length })}
        </p>
      </header>

      {/* ---- 高频错误摘要 ---- */}
      {highFreqErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-5 dark:border-amber-800/30 dark:bg-amber-950/20">
          <div className="mb-3 flex items-center gap-2">
            <svg className="size-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v2m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
            </svg>
            <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              {t("diagnosis.high_freq_errors")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {highFreqErrors.slice(0, 3).map((e, i) => (
              <div
                key={i}
                className="group relative inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100/70 px-3 py-1.5 text-sm dark:border-amber-700 dark:bg-amber-900/30"
                title={pickLocaleField(e, "suggestion", locale)}
              >
                <span className="font-mono font-semibold text-amber-900 dark:text-amber-200">
                  {e.phrase}
                </span>
                <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  ×{e.occurrence}
                </span>
                {e.suggestion && (
                  <span className="ml-1 max-w-xs truncate text-xs text-amber-700/80 dark:text-amber-300/70">
                    {pickLocaleField(e, "suggestion", locale)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {gaps?.map((gap, i) => {
          // 配色按严重度：仅第一项用 destructive，其他改 amber/primary/muted
          const borderColor =
            i === 0
              ? "border-l-4 border-l-amber-500"
              : i === 1
                ? "border-l-4 border-l-primary/60"
                : i === 2
                  ? "border-l-4 border-l-muted-foreground/40"
                  : "";
          const tagColor =
            i === 0
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-primary/10 text-primary dark:bg-primary/20";
          return (
          <div
            key={i}
            className={`rounded-xl border border-border bg-card p-6 shadow-sm ${borderColor}`}
          >
            {/* 角标（仅第一项保留"最需关注"，改用 amber 替代 destructive） */}
            {i === 0 && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mb-2 ${tagColor}`}>
                {t("diagnosis.most_attention")}
              </span>
            )}
            {/* 序号 + 标签（去掉 destructive 红色） */}
            <div className="flex items-center gap-3">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tagColor}`}>
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold text-card-foreground">
                {pickTranslation(gap, "label", locale)}
              </h3>
            </div>
            {/* 原句 vs 参考表达对照 */}
            {gap.evidence_sentence && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border-l-2 border-l-muted-foreground/30 bg-muted/30 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {t("diagnosis.you_said")}
                  </p>
                  <p className="text-sm italic text-muted-foreground">
                    &ldquo;<ClickableEnglish text={gap.evidence_sentence} />&rdquo;
                  </p>
                </div>
                {gap.reference_expression ? (
                  <div className="rounded-lg border-l-2 border-l-primary bg-primary/5 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                      {t("diagnosis.suggest_say")}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      &ldquo;<ClickableEnglish text={gap.reference_expression} />&rdquo;
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border-l-2 border-l-muted-foreground/20 bg-muted/20 px-4 py-3 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground italic">
                      {gap.explanation ? t("diagnosis.detail_below") : t("diagnosis.no_reference")}
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* 解释 */}
            {gap.explanation && (
              <p className="mt-4 text-sm leading-relaxed text-card-foreground">
                {pickTranslation(gap, "explanation", locale)}
              </p>
            )}
          </div>
          );
        })}

      {/* ---- 五维评分（异步加载）---- */}
      {scoresLoading && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm animate-pulse">
          <div className="h-5 w-48 rounded bg-muted mb-3" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 w-full rounded bg-muted/60" />
            ))}
          </div>
        </div>
      )}
      {dimensionScores && Object.keys(dimensionScores).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">
            {t("diagnosis.dim_eval")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(dimensionScores).map(([key, score]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-2.5"
              >
                <span className="text-sm text-card-foreground">{dimLabel(key)}</span>
                <span className="text-sm font-semibold text-primary">
                  {typeof score === "number" ? score.toFixed(1) : score}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- 底部按钮 ---- */}
      <div className="card flex items-center justify-between rounded-xl border border-border bg-card px-6 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {t("diagnosis.enter_facilitate_hint")}
        </p>
        <Button size="lg" onClick={() => router.push("/facilitate")}>
          {t("diagnosis.enter_facilitate")}
        </Button>
      </div>
    </div>
    </TaskGate>
  );
}
