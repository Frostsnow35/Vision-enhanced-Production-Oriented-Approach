"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  getLearningJourney,
  clearLearningJourney,
  type JourneyEntry,
  type JourneyDimensionScore,
} from "@/lib/store";

/* ============================================================
   常量
   ============================================================ */
const DIM_LABELS: Record<string, string> = {
  "发音标准度": "发音标准度",
  "语法规范性": "语法规范性",
  "词汇适配性": "词汇适配性",
  "语言功能达成度": "语言功能达成度",
  "语用策略得体性": "语用策略得体性",
  "话语回合适配性": "话语回合适配性",
  "副语言匹配度": "副语言匹配度",
};

const DIM_ORDER = [
  "发音标准度",
  "语法规范性",
  "词汇适配性",
  "语言功能达成度",
  "语用策略得体性",
  "话语回合适配性",
  "副语言匹配度",
];

/* ============================================================
   工具函数
   ============================================================ */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w} 周前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

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
        {value.toFixed(1)}
      </span>
    </div>
  );
}

/** 七维迷你进度条 */
function MiniDimBars({ scores }: { scores: Record<string, JourneyDimensionScore> }) {
  const visible = DIM_ORDER.filter((d) => scores[d]);

  if (visible.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60 italic">
        暂无维度数据
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {visible.map((dim) => {
        const s = scores[dim];
        const label = DIM_LABELS[dim] ?? dim;
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
              {up ? "+" : ""}{s.change.toFixed(1)}
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
  const router = useRouter();
  const [journey, setJourney] = useState<JourneyEntry[]>([]);

  useEffect(() => {
    setJourney(getLearningJourney());
  }, []);

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
        GlimpSay：AI实景英语交际学习平台
      </h1>

      <p className="mt-3 text-lg font-bold text-primary">
        看见真实场景，开口自然发生。
      </p>

      <div className="mt-6 max-w-xl">
        <p className="text-base leading-relaxed text-muted-foreground">
          GlimpSay 将你身边的校园、餐厅、商店、街角变成英语交际课堂。
          只需拍下眼前场景， AI 就能识别语境、生成任务，并与你展开真实对话练习。
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">7</div>
            <div className="text-sm text-primary-foreground/90">维度评估</div>
          </div>
          <div className="rounded-xl bg-accent p-4 text-center shadow-lg shadow-accent/30">
            <div className="text-3xl font-bold text-accent-foreground">AI</div>
            <div className="text-sm text-accent-foreground/90">实时诊断</div>
          </div>
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">2</div>
            <div className="text-sm text-primary-foreground/90">轮练习</div>
          </div>
        </div>
      </div>

      <Button
        className="mt-10 shadow-lg shadow-primary/30"
        variant="default"
        size="lg"
        onClick={() => router.push("/scenario")}
      >
        开始体验
      </Button>

      {/* ---- 学习旅程区域 ---- */}
      <div className="w-full max-w-3xl mt-16 text-left">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
            <span className="inline-block w-1.5 h-5 rounded-full bg-primary" />
            学习旅程
          </h2>
          {journey.length > 0 && (
            <button
              onClick={() => {
                if (confirm("确定清空所有学习记录？")) {
                  clearLearningJourney();
                  setJourney([]);
                }
              }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              清空
            </button>
          )}
        </div>

        {journey.length === 0 ? (
          /* ---- 无学习记录：引导状态 ---- */
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <p className="text-3xl mb-3">🗣️</p>
            <p className="text-sm font-medium text-card-foreground mb-1">
              开始你的第一次实景口语练习
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              拍下身边场景，AI 即刻生成交际任务，开启沉浸式英语学习
            </p>
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push("/scenario")}
            >
              开始实景练习
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
                title="继续练习"
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
                      {entry.taskTitle || "实景对话任务"}
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
                        七维能力趋势
                      </p>
                      <MiniDimBars scores={entry.dimensionScores} />
                    </div>
                  )}
              </button>
            ))}
            {journey.length > 5 && (
              <p className="text-center text-xs text-muted-foreground/60 pt-1">
                还有 {journey.length - 5} 条历史记录…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
