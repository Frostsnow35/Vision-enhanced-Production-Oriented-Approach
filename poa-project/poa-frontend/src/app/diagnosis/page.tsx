"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import {
  getScenarioHistory,
  isTaskSelectedInSession,
  markTaskSelectedInSession,
  type ScenarioHistoryItem,
} from "@/lib/store";

/* ============================================================
   类型定义
   ============================================================ */
interface GapItem {
  label: string;
  evidence_sentence: string | null;
  explanation: string | null;
}

/* ============================================================
   页面组件
   ============================================================ */
export default function DiagnosisPage() {
  const router = useRouter();
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [gaps, setGaps] = useState<GapItem[] | null>(null);
  const [localDiagnosis, setLocalDiagnosis] = useState<ScenarioHistoryItem | null>(null);
  const taskRef = useRef<ScenarioHistoryItem | null>(null);

  useEffect(() => {
    let hasData = false;
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) { setGaps(JSON.parse(raw)); hasData = true; }
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
          诊断完成
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          未发现明显的语言不足，继续保持！
        </p>
        <Button
          className="mt-6"
          onClick={() => router.push("/facilitate")}
        >
          进入促成学习 →
        </Button>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- 页面标题 ---- */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          初次产出诊断报告
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          以下是你的核心不足，共 {gaps.length} 项
        </p>
      </header>

      {/* ---- Gap 卡片列表 ---- */}
      <div className="space-y-4">
        {gaps?.map((gap, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            {/* 序号 + 标签 */}
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-sm font-bold text-destructive">
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold text-destructive">
                {gap.label}
              </h3>
            </div>

            {/* 证据句 */}
            {gap.evidence_sentence && (
              <blockquote className="mt-4 rounded-lg border-l-3 border-muted-foreground/30 bg-muted/50 px-4 py-2.5">
                <p className="text-sm italic text-muted-foreground">
                  &ldquo;{gap.evidence_sentence}&rdquo;
                </p>
              </blockquote>
            )}

            {/* 解释 */}
            {gap.explanation && (
              <p className="mt-4 text-sm leading-relaxed text-card-foreground">
                {gap.explanation}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ---- 底部按钮 ---- */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-6 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          查看诊断结果后，进入针对性的促成学习
        </p>
        <Button size="lg" onClick={() => router.push("/facilitate")}>
          进入促成学习 →
        </Button>
      </div>
    </div>
  );
}
