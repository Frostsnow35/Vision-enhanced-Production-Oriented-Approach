"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  getLearningJourney,
  clearLearningJourney,
  type JourneyEntry,
  type JourneyDimensionScore,
} from "@/lib/store";

/* ============================================================
   子组件
   ============================================================ */

/** 分数圆环 */
function ScoreRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value / 5));
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const color =
    pct >= 0.8 ? "text-emerald-500" : pct >= 0.6 ? "text-amber-500" : "text-rose-500";
  return (
    <div className="relative inline-flex items-center justify-center w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle
          cx="24" cy="24" r={r}
          fill="none" stroke="currentColor" strokeWidth="4"
          className="text-muted/30"
        />
        <circle
          cx="24" cy="24" r={r}
          fill="none"
          stroke="currentColor" strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className={`absolute text-xs font-semibold ${color}`}>
        {(value ?? 0).toFixed(1)}
      </span>
    </div>
  );
}

/** 七维迷你进度条 */
function MiniDimBars({
  scores,
  dimLabels,
  dimOrder,
  noDataText,
}: {
  scores: Record<string, JourneyDimensionScore>;
  dimLabels: Record<string, string>;
  dimOrder: string[];
  noDataText: string;
}) {
  const visible = dimOrder.filter((d) => scores[d]);

  if (visible.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60 italic">
        {noDataText}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {visible.map((dim) => {
        const s = scores[dim];
        const label = dimLabels[dim] ?? dim;
        const a1Pct = Math.min(100, Math.max(0, ((s.attempt1 || 0) / 5) * 100));
        const a2Pct = Math.min(100, Math.max(0, ((s.attempt2 || 0) / 5) * 100));
        const up = s.change > 0;
        const flat = s.change === 0;

        return (
          <div key={dim} className="flex items-center gap-2">
            <span className="w-10 text-[10px] text-muted-foreground truncate flex-shrink-0 text-right">
              {label.slice(0, 3)}
            </span>
            {/* 初产 / 二产 双条 */}
            <div className="flex-1 flex items-center gap-0.5 min-w-0">
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{ width: `${a1Pct}%` }}
                />
              </div>
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent/80 transition-all"
                  style={{ width: `${a2Pct}%` }}
                />
              </div>
            </div>
            {/* 变化量 */}
            <span
              className={`w-8 text-[10px] text-right tabular-nums font-medium ${
                up
                  ? "text-emerald-600"
                  : flat
                    ? "text-muted-foreground/50"
                    : "text-rose-500"
              }`}
            >
              {up ? "+" : ""}{(s.change ?? 0).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   首页主组件
   ============================================================ */
export default function Home() {
  const t = useTranslations();
  const router = useRouter();
  const [journey, setJourney] = useState<JourneyEntry[]>([]);

  useEffect(() => {
    setJourney(getLearningJourney());
  }, []);

  // 维度标签（通过翻译动态获取）
  const dimLabels = useMemo<Record<string, string>>(() => ({
    "发音标准度": t("dims.pronunciation"),
    "语法规范性": t("dims.grammar"),
    "词汇适配性": t("dims.vocabulary"),
    "语言功能达成度": t("dims.function"),
    "语用策略得体性": t("dims.pragmatics"),
    "话语回合适配性": t("dims.turn_taking"),
    "副语言匹配度": t("dims.paralanguage"),
  }), [t]);

  const dimOrder = useMemo(() => [
    "发音标准度",
    "语法规范性",
    "词汇适配性",
    "语言功能达成度",
    "语用策略得体性",
    "话语回合适配性",
    "副语言匹配度",
  ], []);

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return t("home.just_now");
    if (min < 60) return t("home.minutes_ago", { min });
    const h = Math.floor(min / 60);
    if (h < 24) return t("home.hours_ago", { h });
    const d = Math.floor(h / 24);
    if (d < 7) return t("home.days_ago", { d });
    const w = Math.floor(d / 7);
    if (w < 4) return t("home.weeks_ago", { w });
    return new Date(ts).toLocaleDateString("zh-CN");
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {/* ---- 品牌区 ---- */}
      <div className="mb-8 flex items-center gap-4">
        <Image
          src="/logo.png"
          alt="POA Logo"
          width={160}
          height={160}
          className="h-40 w-40"
          priority
        />
      </div>

      <h1 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl animate-float gradient-text">
        {t("home.title")}
      </h1>

      <p className="mt-3 text-lg font-bold text-primary">
        {t("home.subtitle")}
      </p>

      <div className="mt-6 max-w-xl">
        <p className="text-base leading-relaxed text-muted-foreground">
          {t("home.description")}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">7</div>
            <div className="text-sm text-primary-foreground/90">{t("home.dim_assessment")}</div>
          </div>
          <div className="rounded-xl bg-accent p-4 text-center shadow-lg shadow-accent/30">
            <div className="text-3xl font-bold text-accent-foreground">AI</div>
            <div className="text-sm text-accent-foreground/90">{t("home.realtime_diagnosis")}</div>
          </div>
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">2</div>
            <div className="text-sm text-primary-foreground/90">{t("home.rounds_practice")}</div>
          </div>
        </div>
      </div>

      <Button
        className="mt-10 shadow-lg shadow-primary/30"
        variant="default"
        size="lg"
        onClick={() => router.push("/scenario")}
      >
        {t("home.start_experience")}
      </Button>

      {/* ---- 学习旅程区域 ---- */}
      <div className="w-full max-w-3xl mt-16 text-left">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
            <span className="inline-block w-1.5 h-5 rounded-full bg-primary" />
            {t("home.learning_journey")}
          </h2>
          {journey.length > 0 && (
            <button
              onClick={() => {
                if (confirm(t("home.clear_confirm"))) {
                  clearLearningJourney();
                  setJourney([]);
                }
              }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {t("home.clear")}
            </button>
          )}
        </div>

        {journey.length === 0 ? (
          /* ---- 无学习记录：引导状态 ---- */
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <p className="text-3xl mb-3">🗣️</p>
            <p className="text-sm font-medium text-card-foreground mb-1">
              {t("home.empty_title")}
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              {t("home.empty_desc")}
            </p>
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push("/scenario")}
            >
              {t("home.start_practice")}
            </Button>
          </div>
        ) : (
          /* ---- 有学习记录：卡片列表 ---- */
          <div className="space-y-3">
            {journey.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="w-full text-left rounded-lg border border-border bg-card px-4 py-3 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
                onClick={() => router.push("/scenario")}
                title={t("home.continue_practice")}
              >
                {/* 第一行：分数 + 标签 + 时间 */}
                <div className="flex items-center gap-3">
                  <ScoreRing value={entry.avgScore} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                        {entry.sceneLabel}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {timeAgo(entry.completedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-card-foreground/80 truncate">
                      {entry.taskTitle || t("home.task_label")}
                    </p>
                  </div>
                  {/* 右箭头 */}
                  <span className="text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0">
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </div>

                {/* 第二行：七维迷你趋势 */}
                {entry.dimensionScores &&
                  Object.keys(entry.dimensionScores).length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-border/60">
                      <p className="text-[10px] text-muted-foreground/60 mb-1.5 font-medium">
                        {t("home.dim_trend")}
                      </p>
                      <MiniDimBars
                        scores={entry.dimensionScores}
                        dimLabels={dimLabels}
                        dimOrder={dimOrder}
                        noDataText={t("home.no_dim_data")}
                      />
                    </div>
                  )}
              </button>
            ))}
            {journey.length > 5 && (
              <p className="text-center text-xs text-muted-foreground/60 pt-1">
                {t("home.more_records", { count: journey.length - 5 })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
