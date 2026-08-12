"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { BASE_URL, buildImageUrl } from "@/lib/api";
import { pickLocaleField, pickTranslation } from "@/lib/locale-utils";
import { getScenarioHistory, selectScenario, type ScenarioHistoryItem } from "@/lib/store";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";
import {
  Camera,
  ClipboardList,
  Mic,
  Search,
  BookOpen,
  Repeat,
  BarChart3,
} from "lucide-react";

/* ============================================================ */
interface ReportData {
  run_id: number;
  scenario: Record<string, any> | null;
  task: Record<string, any> | null;
  attempt1: Record<string, any> | null;
  attempt2: Record<string, any> | null;
  diagnosis: { gaps: Record<string, any>[] };
  diagnosis_attempt2: { gaps: Record<string, any>[] };
  facilitation: { input_packs: Record<string, any>[] };
  evaluation: Record<string, any> | null;
}

/* ============================================================ */
function TimelineNode({
  idx,
  icon,
  title,
  borderColor,
  collapsed,
  onToggle,
  children,
}: {
  idx: number;
  icon: React.ReactNode;
  title: string;
  borderColor?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations();

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* 竖线和图标 */}
      <div className="flex flex-col items-center">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 ${borderColor || "border-primary/30"} bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm`}>
          {icon}
        </div>
        <div className={`w-0.5 flex-1 transition-colors duration-300 ${collapsed ? "bg-border/50" : "bg-primary/20"}`} />
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 pt-1">
        <button
          onClick={onToggle}
          className="group flex w-full items-center gap-3 text-left transition-all hover:bg-muted/50 rounded-lg p-2 -m-2"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {idx}
          </span>
          <span className="text-sm font-semibold text-card-foreground">{title}</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-transform duration-300">
            {collapsed ? t("common.expand") : t("common.collapse")}
            <svg className={`size-3 transition-transform ${collapsed ? "" : "rotate-180"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </span>
        </button>

        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${collapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"}`}
        >
          <div className="mt-3 card backdrop-blur-sm border-border/80 bg-card/80 p-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
function SceneContent({ scenario, historyItem }: { scenario: Record<string, any> | null; historyItem: ScenarioHistoryItem | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const imgPath = scenario?.image_path || historyItem?.imageUrl || "";
  const imgUrl = buildImageUrl(imgPath);
  const sceneLabel = pickLocaleField(scenario, "scene_label", locale) || historyItem?.sceneLabel || t("report.unknown_scene");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-card-foreground">{sceneLabel}</p>
        {scenario?.created_at && (
          <span className="text-xs text-muted-foreground">{scenario.created_at.slice(0, 10)}</span>
        )}
      </div>
      
      {imgUrl ? (
        <div className="relative group rounded-xl overflow-hidden bg-muted/30">
          <img
            src={imgUrl}
            alt={sceneLabel}
            className="w-full max-h-64 object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
              target.parentElement?.querySelector(".fallback-image")?.classList.remove("hidden");
            }}
          />
          <div className="hidden fallback-image flex h-48 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <svg className="mx-auto size-12 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <p className="mt-2 text-sm">{t("report.image_load_failed")}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center rounded-xl bg-muted/30">
          <svg className="size-12 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
function TaskContent({ task, historyItem }: { task: Record<string, any> | null; historyItem: ScenarioHistoryItem | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const roles = pickLocaleField(task, "roles", locale) || historyItem?.roles || "";
  const goal = pickLocaleField(task, "goal", locale) || historyItem?.goal || "";
  
  const parseRoles = (raw: string) => {
    const splitRe = /(?:；|;)\s*B[:：]\s*/i;
    const parts = raw.split(splitRe);
    return {
      user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || t("common.not_specified"),
      ai: parts[1]?.trim() || t("common.not_specified"),
    };
  };
  
  const parsedRoles = parseRoles(roles);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-primary/5 p-4 border border-primary/10">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary/70 mb-2">{t("report.you_play")}</p>
          <p className="text-sm font-medium text-card-foreground">{parsedRoles.user}</p>
        </div>
        <div className="rounded-lg bg-secondary/5 p-4 border border-secondary/10">
          <p className="text-xs font-semibold uppercase tracking-wider text-secondary/70 mb-2">{t("report.ai_play")}</p>
          <p className="text-sm font-medium text-card-foreground">{parsedRoles.ai}</p>
        </div>
      </div>

      {goal && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("report.goal")}</p>
          <p className="text-sm leading-relaxed text-card-foreground">{goal}</p>
        </div>
      )}

      {task?.context && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("report.context")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground bg-muted/30 rounded-lg p-3">
            {pickLocaleField(task, "context", locale)}
          </p>
        </div>
      )}

      {task?.success_criteria && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("report.criteria")}</p>
          <div className="space-y-2">
            {(pickLocaleField(task, "success_criteria", locale) as string).split(/\d+\./).filter(Boolean).map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="flex-shrink-0 mt-1 size-1.5 rounded-full bg-primary" />
                <span className="text-muted-foreground">{item.trim()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
function AttemptContent({ attempt }: { attempt: Record<string, any> | null }) {
  const t = useTranslations();
  if (!attempt) return <p className="text-sm text-muted-foreground">{t("report.no_output")}</p>;

  const audioPath = attempt.audio_path ?? "";
  const audioUrl = audioPath.startsWith("/") ? `${BASE_URL}${audioPath}` : audioPath;

  return (
    <div className="space-y-4">
      {(attempt.text || attempt.attempt_text) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">{t("report.dialog_record")}</span>
          </div>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm text-card-foreground font-sans">
            {attempt.text || attempt.attempt_text}
          </pre>
        </div>
      )}

      {audioUrl && (
        <div className="space-y-3">
          <span className="text-xs font-semibold text-muted-foreground">{t("report.audio_replay")}</span>
          <audio
            src={audioUrl}
            controls
            className="w-full rounded-lg bg-muted/50 p-2"
          />
        </div>
      )}

      {attempt.timestamp && (
        <p className="text-xs text-muted-foreground">
          {t("report.completed_at")}{attempt.timestamp}
        </p>
      )}
    </div>
  );
}

/* ============================================================ */
function DiagnosisContent({ gaps }: { gaps: Record<string, any>[] }) {
  const t = useTranslations();
  const locale = useLocale();
  if (gaps.length === 0) return <p className="text-sm text-muted-foreground">{t("report.no_diagnosis")}</p>;
  
  return (
    <div className="space-y-4">
      {gaps.map((gap, index) => (
        <div key={index} className="rounded-lg bg-amber-50/50 border border-amber-100 p-4">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 flex size-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
              {index + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                {pickTranslation(gap, "label", locale) || pickTranslation(gap, "description", locale)}
              </p>
              {gap.suggestion && (
                <p className="mt-1 text-xs text-amber-600">{t("report.suggestion_prefix")}<ClickableEnglish text={pickTranslation(gap, "suggestion", locale)} /></p>
              )}
              {gap.explanation && (
                <p className="mt-1 text-xs text-amber-600"><ClickableEnglish text={pickTranslation(gap, "explanation", locale)} /></p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================ */
function parseJsonField(val: any): any {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function FacilitationContent({ packs }: { packs: Record<string, any>[] }) {
  const t = useTranslations();
  const locale = useLocale();
  if (packs.length === 0) return <p className="text-sm text-muted-foreground">{t("report.no_learning_material")}</p>;

  return (
    <div className="space-y-4">
      {packs.map((pack, index) => {
        // Locale-aware array fields: prefer translations column, then _en suffix, then original
        let rawChunks = pack.scene_chunks;
        let rawDialogue = pack.demo_dialogue;
        if (locale === "en") {
          const tr = pack.translations as Record<string, any> | undefined;
          if (tr?.scene_chunks) rawChunks = tr.scene_chunks;
          else if (pack.scene_chunks_en) rawChunks = pack.scene_chunks_en;
          if (tr?.demo_dialogue) rawDialogue = tr.demo_dialogue;
          else if (pack.demo_dialogue_en) rawDialogue = pack.demo_dialogue_en;
        }
        const phrases = parseJsonField(rawChunks);
        const dialogue = parseJsonField(rawDialogue);
        return (
        <div key={index} className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">{t("report.learning_material", { n: index + 1 })}</p>

          {Array.isArray(phrases) && phrases.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-medium text-muted-foreground">{t("report.scene_chunks")}</p>
              <div className="space-y-1.5">
                {phrases.map((p: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded bg-muted/30 px-3 py-1.5">
                    <span className="text-[10px] font-medium text-primary shrink-0 mt-0.5">{pickTranslation(p, "function", locale)}</span>
                    <span className="text-xs text-card-foreground"><ClickableEnglish text={pickTranslation(p, "sentence", locale)} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(dialogue) && dialogue.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-medium text-muted-foreground">{t("report.demo_dialogue")}</p>
              <div className="space-y-1">
                {dialogue.map((d: any, i: number) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="font-medium text-primary shrink-0">{d.speaker}:</span>
                    <span className="text-card-foreground"><ClickableEnglish text={pickTranslation(d, "text", locale)} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

/* ============================================================ */

function toFixed(v: number, d: number) {
  return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
}

function renderChange(change: number | undefined) {
  if (change === undefined || change === null) return null;
  const isUp = change > 0;
  const color = isUp ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";
  return (
    <span className={`text-[11px] font-semibold ${color} w-12 shrink-0`}>
      {isUp ? "+" : ""}{change.toFixed(1)}
    </span>
  );
}

function EvaluationContent({ evaluation }: { evaluation: Record<string, any> | null }) {
  const t = useTranslations();
  const locale = useLocale();
  if (!evaluation) return <p className="text-sm text-muted-foreground">{t("report.no_evaluation")}</p>;

  const dims = evaluation.dimension_scores ?? {};
  const entries = Object.entries(dims);

  const isComparison = entries.some(([, v]) =>
    typeof v === "object" && v !== null && "attempt1" in v && "attempt2" in v
  );

  const sortedEntries = isComparison
    ? entries.sort(([, a], [, b]) => {
        const ca = typeof a === "object" && a !== null ? (a as any).change ?? 0 : 0;
        const cb = typeof b === "object" && b !== null ? (b as any).change ?? 0 : 0;
        return cb - ca;
      })
    : entries;

  /**
   * Get locale-aware dimension label.
   * If the dimension value object has a `comment_en` field, use the English comment as label in en mode.
   * Otherwise fall back to the dimension key itself (which is the label in Chinese).
   */
  const dimLabel = (key: string, val: Record<string, any>): string => {
    if (locale === "en" && val?.comment_en) return val.comment_en;
    return key;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("report.eval_time")}</span>
        <span className="text-xs text-card-foreground">{evaluation.created_at?.slice(0, 10) ?? ""}</span>
      </div>

      {sortedEntries.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">{t("report.dim_score")}</p>
          <div className="space-y-2">
            {sortedEntries.map(([key, value]) => {
              const isComparisonItem =
                typeof value === "object" && value !== null && "attempt1" in value && "attempt2" in value;

              const score =
                typeof value === "object" && value !== null && "attempt2" in value
                  ? (value as any).attempt2
                  : value;

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{dimLabel(key, value as Record<string, any>)}</span>
                    {isComparisonItem ? (
                      <span className="font-medium text-card-foreground">
                        {toFixed((value as any).attempt1, 1)} → {toFixed((value as any).attempt2, 1)}{t("report.score")}
                      </span>
                    ) : (
                      <span className="font-medium text-card-foreground">{score}{t("report.score")}</span>
                    )}
                  </div>
                  {isComparisonItem ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground w-4 shrink-0">A1</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div className="h-full rounded-full bg-gray-400" style={{ width: `${(value as any).attempt1 * 20}%` }} />
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground w-7 text-right">{toFixed((value as any).attempt1, 1)}</span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-[11px] text-blue-600 dark:text-blue-400 w-4 shrink-0">A2</span>
                        <div className="flex-1 h-2 rounded-full bg-blue-100 dark:bg-blue-950 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${(value as any).attempt2 * 20}%` }} />
                        </div>
                        <span className="text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400 w-7 text-right">{toFixed((value as any).attempt2, 1)}</span>
                      </div>
                      {renderChange((value as any).change)}
                    </div>
                  ) : (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-500"
                        style={{ width: `${Math.min((score / 10) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {evaluation.full_report && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("report.overall_eval")}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm text-card-foreground">
            <ClickableEnglish text={pickTranslation(evaluation, "full_report", locale)} />
          </pre>
        </div>
      )}

      {evaluation.problem_improved && (
        <div className="rounded-lg bg-green-50/50 border border-green-100 p-4">
          <p className="text-xs font-medium text-green-700 mb-2">{t("report.improvement")}</p>
          <pre className="whitespace-pre-wrap text-xs text-green-600">
            <ClickableEnglish text={pickTranslation(evaluation, "problem_improved", locale)} />
          </pre>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();

  // 折叠状态
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  
  // 检查是否有当前激活的场景
  const [hasValidScenario, setHasValidScenario] = useState<boolean | null>(null);

  useEffect(() => {
    const history = getScenarioHistory();
    
    // 检查当前 id 是否在历史记录中
    const scenarioExists = history.some(s => s.id === id);
    
    if (!scenarioExists) {
      setHasValidScenario(false);
    } else {
      // 确保当前场景被选中
      selectScenario(id);
      setHasValidScenario(true);
    }
  }, [id]);

  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyItem, setHistoryItem] = useState<ScenarioHistoryItem | null>(null);
  const [reportError, setReportError] = useState<{ kind: "not_found" | "server" | "network"; message: string } | null>(null);

  const loadReport = async () => {
    const history = getScenarioHistory();
    const item = history.find(h => h.id === id);
    setHistoryItem(item || null);

    const scenarioId = item?.scenarioId;

    if (!scenarioId) {
      setReportError({
        kind: "not_found",
        message: t("common.record_not_found"),
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/report/${scenarioId}`);
      if (res.ok) {
        setReport(await res.json());
        setReportError(null);
      } else if (res.status === 404) {
        setReportError({
          kind: "not_found",
          message: t("common.record_expired"),
        });
      } else {
        setReportError({
          kind: "server",
          message: t("common.report_error"),
        });
      }
    } catch (err) {
      console.error("Failed to fetch report:", err);
      setReportError({
        kind: "network",
        message: t("common.network_error"),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasValidScenario === false) return;
    setLoading(true);
    setReportError(null);
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasValidScenario]);

  const handleRetry = () => {
    setLoading(true);
    setReportError(null);
    loadReport();
  };

  const handleBackToList = () => {
    router.push("/");
  };

  const toggle = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }));

  // 打印
  const handlePrint = () => {
    setCollapsed({});
    setTimeout(() => window.print(), 200);
  };

  // 如果没有有效场景，显示选择器
  if (hasValidScenario === false) {
    return (
      <div className="py-8">
        <HistoryTaskSelector 
          autoRedirectIfEmpty={false}
          reloadOnSelect={false}
          onSelected={(item) => {
            router.push(`/report/${item.id}`);
          }}
        />
      </div>
    );
  }

  // ---- 加载中 ----
  if (loading || hasValidScenario === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center">
            <svg className="size-6 animate-spin text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">{t("report.loading")}</p>
        </div>
      </div>
    );
  }

  // ---- 错误状态卡片（仅无本地缓存时才显示）----
  if (reportError && !historyItem) {
    const tone =
      reportError.kind === "not_found"
        ? {
            ring: "border-amber-200",
            bg: "bg-amber-50/50",
            icon: "📂",
            title: t("report.not_found"),
            iconBg: "bg-amber-100",
            iconText: "text-amber-700",
          }
        : reportError.kind === "server"
        ? {
            ring: "border-amber-200",
            bg: "bg-amber-50/50",
            icon: "⚠️",
            title: t("report.error"),
            iconBg: "bg-amber-100",
            iconText: "text-amber-700",
          }
        : {
            ring: "border-amber-200",
            bg: "bg-amber-50/50",
            icon: "📡",
            title: t("report.network_error"),
            iconBg: "bg-amber-100",
            iconText: "text-amber-700",
          };

    return (
      <div className="mx-auto max-w-2xl py-16">
        <div className={`rounded-2xl border ${tone.ring} ${tone.bg} p-8 text-center shadow-sm`}>
          <div className={`mx-auto flex size-16 items-center justify-center rounded-full ${tone.iconBg} text-3xl`}>
            {tone.icon}
          </div>
          <h2 className="mt-5 text-lg font-semibold text-card-foreground">{tone.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{reportError.message}</p>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            {reportError.kind !== "not_found" && (
              <Button onClick={handleRetry} size="sm" className="w-full sm:w-auto">
                🔄 {t("common.reload")}
              </Button>
            )}
            <Button variant="outline" onClick={handleBackToList} size="sm" className="w-full sm:w-auto">
              {t("common.back_home")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 使用历史记录或后端报告数据
  const sceneLabel = (historyItem as any)?.sceneLabel || pickLocaleField(report?.scenario, "scene_label", locale) || t("report.unknown_scene");
  const createdAt = report?.scenario?.created_at?.slice(0, 10) || (historyItem as any)?.createdAt?.slice(0, 10) || "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* 顶部装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-secondary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-12">
        {reportError && historyItem && (
          <div className="mb-6 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("report.partial_notice")}</p>
          </div>
        )}
        {/* 标题区域 */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 mb-4">
            <svg className="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span className="text-xs font-semibold text-primary">{t("report.title_short")}</span>
          </div>
          
          <h1 className="text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl mb-2">
            {t("report.subtitle")}
          </h1>
          <p className="text-muted-foreground">
            {sceneLabel}{createdAt ? ` · ${createdAt}` : ""}
          </p>

          <div className="flex items-center gap-3 mt-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handlePrint}
              className="gap-2"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 11H8m0 0v6m0-6l-8 4m8-4l8 4" />
              </svg>
              {t("report.export")}
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.push("/")}
            >
              {t("common.back_home")}
            </Button>
          </div>
        </header>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          <div className="rounded-xl bg-card border border-border/50 p-4 shadow-sm">
            <p className="text-2xl font-bold text-primary mb-1">7</p>
            <p className="text-xs text-muted-foreground">{t("report.stats_learning_steps")}</p>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4 shadow-sm">
            <p className="text-2xl font-bold text-secondary mb-1">
              {report?.attempt1 ? "✓" : "-"}
            </p>
            <p className="text-xs text-muted-foreground">{t("report.stats_attempt1")}</p>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4 shadow-sm">
            <p className="text-2xl font-bold text-amber-500 mb-1">
              {report?.diagnosis?.gaps?.length || 0}
            </p>
            <p className="text-xs text-muted-foreground">{t("report.stats_diagnosis")}</p>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4 shadow-sm">
            <p className="text-2xl font-bold text-green-500 mb-1">
              {report?.attempt2 ? "✓" : "-"}
            </p>
            <p className="text-xs text-muted-foreground">{t("report.stats_attempt2")}</p>
          </div>
        </div>

        {/* 时间线 */}
        <div className="card p-6 border-border/50">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-card-foreground">{t("report.timeline")}</h2>
            <p className="text-sm text-muted-foreground">{t("report.timeline_desc")}</p>
          </div>

          <div className="relative ml-2">
            <TimelineNode
              idx={1}
              icon={<Camera className="size-5 text-sky-500" />}
              title={t("report.node_scene_photo")}
              borderColor="border-sky-400/40"
              collapsed={collapsed["scene"] ?? false}
              onToggle={() => toggle("scene")}
            >
              <SceneContent scenario={report?.scenario ?? null} historyItem={historyItem} />
            </TimelineNode>

            <TimelineNode
              idx={2}
              icon={<ClipboardList className="size-5 text-violet-500" />}
              title={t("report.node_task")}
              borderColor="border-violet-400/40"
              collapsed={collapsed["task"] ?? false}
              onToggle={() => toggle("task")}
            >
              <TaskContent task={report?.task ?? null} historyItem={historyItem} />
            </TimelineNode>

            <TimelineNode
              idx={3}
              icon={<Mic className="size-5 text-fuchsia-500" />}
              title={t("report.node_attempt1")}
              borderColor="border-fuchsia-400/40"
              collapsed={collapsed["attempt1"] ?? false}
              onToggle={() => toggle("attempt1")}
            >
              <AttemptContent attempt={report?.attempt1 ?? null} />
            </TimelineNode>

            <TimelineNode
              idx={4}
              icon={<Search className="size-5 text-red-500" />}
              title={t("report.node_diagnosis")}
              borderColor="border-red-400/40"
              collapsed={collapsed["diagnosis"] ?? false}
              onToggle={() => toggle("diagnosis")}
            >
              <DiagnosisContent gaps={report?.diagnosis?.gaps ?? []} />
            </TimelineNode>

            <TimelineNode
              idx={5}
              icon={<BookOpen className="size-5 text-emerald-500" />}
              title={t("report.node_facilitate")}
              borderColor="border-emerald-400/40"
              collapsed={collapsed["facilitation"] ?? false}
              onToggle={() => toggle("facilitation")}
            >
              <FacilitationContent packs={report?.facilitation?.input_packs ?? []} />
            </TimelineNode>

            <TimelineNode
              idx={6}
              icon={<Repeat className="size-5 text-fuchsia-500" />}
              title={t("report.node_attempt2")}
              borderColor="border-fuchsia-400/40"
              collapsed={collapsed["attempt2"] ?? false}
              onToggle={() => toggle("attempt2")}
            >
              <AttemptContent attempt={report?.attempt2 ?? null} />
            </TimelineNode>

            <TimelineNode
              idx={7}
              icon={<BarChart3 className="size-5 text-amber-500" />}
              title={t("report.node_evaluation")}
              borderColor="border-amber-400/40"
              collapsed={collapsed["evaluation"] ?? false}
              onToggle={() => toggle("evaluation")}
            >
              <EvaluationContent evaluation={report?.evaluation ?? null} />
            </TimelineNode>
          </div>
        </div>

        {/* 底部信息 */}
        <footer className="mt-10 text-center">
          <p className="text-xs text-muted-foreground">
            {t("report.footer")}
          </p>
        </footer>
      </div>
    </div>
  );
}
