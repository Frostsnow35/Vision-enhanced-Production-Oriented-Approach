"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getScenarioHistory,
  selectScenario,
  type ScenarioHistoryItem,
} from "@/lib/store";
import { buildImageUrl } from "@/lib/api";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}

export default function ReportListPage() {
  const router = useRouter();
  const [history, setHistory] = useState<ScenarioHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setHistory(getScenarioHistory());
  }, []);

  function handleSelect(id: string) {
    setSelectedId(id);
    selectScenario(id);
  }

  function handleViewReport() {
    if (selectedId) {
      router.push(`/report/${selectedId}`);
    }
  }

  function handleStartFresh() {
    router.push("/scenario");
  }

  if (history.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
        <div className="text-center space-y-3 max-w-md">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="size-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-card-foreground">暂无学习记录</h2>
          <p className="text-sm text-muted-foreground">请先完成一次学习任务，才能查看学习报告</p>
          <Button size="lg" className="mt-4" onClick={handleStartFresh}>
            上传场景照片开始学习
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* 顶部装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-secondary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-4 py-12">
        {/* 标题区域 */}
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 mb-4">
            <svg className="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span className="text-xs font-semibold text-primary">学习证据链</span>
          </div>
          
          <h1 className="text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl mb-2">
            选择学习报告
          </h1>
          <p className="text-muted-foreground">
            请选择要查看的学习任务报告
          </p>
        </header>

        {/* 历史任务卡片 */}
        <div className="space-y-3 mb-6">
          {history.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all ${
                selectedId === item.id
                  ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/30"
                  : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
              }`}
            >
              {/* 缩略图 */}
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {item.imageUrl ? (
                  <img
                    src={buildImageUrl(item.imageUrl)}
                    alt={item.sceneLabel}
                    className="size-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <svg className="size-8 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                )}
              </div>

              {/* 信息 */}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-card-foreground truncate">
                  {item.sceneLabel}
                </p>
                <p className="text-xs text-muted-foreground/70 truncate">
                  {item.goal?.slice(0, 60)}
                </p>
                <p className="text-xs text-muted-foreground/50">
                  {formatTime(item.createdAt)}
                </p>
              </div>

              {/* 选中指示 */}
              {selectedId === item.id && (
                <div className="shrink-0 size-6 rounded-full bg-primary flex items-center justify-center">
                  <svg className="size-4 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleStartFresh}>
            上传新照片开始新任务
          </Button>
          {selectedId ? (
            <Button className="flex-1" onClick={handleViewReport}>
              查看报告 →
            </Button>
          ) : (
            <Button className="flex-1" disabled>
              请先选择一个任务
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
