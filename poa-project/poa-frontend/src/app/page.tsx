"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getLearningJourney, clearLearningJourney, type JourneyEntry } from "@/lib/store";

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

function ScoreRing({ value }: { value: number }) {
  // value 0-5, 渲染为百分比圆环
  const pct = Math.max(0, Math.min(1, value / 5));
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const color = pct >= 0.8 ? "text-emerald-500" : pct >= 0.6 ? "text-amber-500" : "text-rose-500";
  return (
    <div className="relative inline-flex items-center justify-center w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
        <circle
          cx="24" cy="24" r={r} fill="none"
          stroke="currentColor" strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className={`absolute text-xs font-semibold ${color}`}>{value.toFixed(1)}</span>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [journey, setJourney] = useState<JourneyEntry[]>([]);

  useEffect(() => {
    setJourney(getLearningJourney());
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
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
          只需拍下眼前场景，AI 就能识别语境、生成任务，并与你展开真实对话练习；
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
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <p className="text-3xl mb-2">🌱</p>
            <p className="text-sm text-muted-foreground">
              还没有学习记录，开始你的第一次实景对话吧！
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {journey.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow"
              >
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary"
                  onClick={() => router.push("/scenario")}
                >
                  再来一次
                </Button>
              </div>
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
