"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getScenarioHistory,
  clearSessionTaskMark,
  type ScenarioHistoryItem,
} from "@/lib/store";
import { BASE_URL, buildImageUrl } from "@/lib/api";

interface Props {
  onSelected?: (item: ScenarioHistoryItem) => void;
  /** 渲染完选择器后，如果是空的就自动跳转场景页 */
  autoRedirectIfEmpty?: boolean;
  /** 选择后是否重新加载当前页面，而不是跳转到 task 页 */
  reloadOnSelect?: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}

export default function HistoryTaskSelector({ 
  onSelected, 
  autoRedirectIfEmpty = false,
  reloadOnSelect = false,
}: Props) {
  const router = useRouter();
  const [history, setHistory] = useState<ScenarioHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setHistory(getScenarioHistory());
  }, []);

  function handleSelect(id: string) {
    setSelectedId(id);
    const list = getScenarioHistory();
    const item = list.find((s) => s.id === id) ?? null;
    if (item) {
      onSelected?.(item);
    }
  }

  function handleStartFresh() {
    clearSessionTaskMark();
    router.push("/scenario");
  }

  function handleContinue() {
    if (reloadOnSelect) {
      router.refresh();
    } else {
      router.push("/task");
    }
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-card-foreground">暂无学习记录</h2>
          <p className="text-sm text-muted-foreground">请先上传一张场景照片，开始学习</p>
        </div>
        <Button size="lg" onClick={handleStartFresh}>
          上传场景照片开始学习
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-card-foreground">选择学习任务</h2>
        <p className="text-sm text-muted-foreground">
          请选择之前的学习任务继续，或上传新照片开始新任务
        </p>
      </div>

      {/* 历史任务卡片 */}
      <div className="space-y-3">
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
                {item.goal.slice(0, 60)}
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
        {selectedId && (
          <Button className="flex-1" onClick={handleContinue}>
            继续此任务 →
          </Button>
        )}
      </div>
    </div>
  );
}
