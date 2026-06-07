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
   安全解析 diagnosis 数据，始终返回 GapItem[]
   ============================================================ */
function parseDiagnosisGaps(raw: string | null): GapItem[] {
  if (!raw) return [];

  try {
    const data = JSON.parse(raw);

    // 情况 1: data 本身就是数组 → 直接返回
    if (Array.isArray(data)) return data as GapItem[];

    // 情况 2: data 是对象，包含 gaps 字段
    if (data && typeof data === "object" && Array.isArray(data.gaps)) {
      return data.gaps as GapItem[];
    }

    // 情况 3: data 是对象但不含 gaps，尝试其他常见字段
    if (data && typeof data === "object") {
      if (Array.isArray(data.dimension_scores)) return [];
      if (Array.isArray(data.comparison)) return [];
    }

    return [];
  } catch {
    return [];
  }
}

/* ============================================================
   页面组件
   ============================================================ */
export default function DiagnosisPage() {
  const router = useRouter();
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [diagnosisNote, setDiagnosisNote] = useState("");
  const [transcribedText, setTranscribedText] = useState("");
  const taskRef = useRef<ScenarioHistoryItem | null>(null);

  useEffect(() => {
    let hasData = false;

    // 读取转写文本（多源回退：diagnosis.transcribed_text → attempt1_full_text → diagnosis.evidence_sentence）
    let savedText = "";
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const data = JSON.parse(raw);
        const parsed = parseDiagnosisGaps(raw);
        if (parsed.length > 0) { setGaps(parsed); hasData = true; }
        if (data?.note && typeof data.note === "string") { setDiagnosisNote(data.note); hasData = true; }
        // 优先从 diagnosis 读取
        if (data?.transcribed_text && typeof data.transcribed_text === "string") {
          savedText = data.transcribed_text;
        }
      }
    } catch { /* ignore */ }
    // 回退：从 attempt1_full_text 读取
    if (!savedText) {
      try {
        const raw = localStorage.getItem("attempt1_full_text");
        if (raw && raw.trim()) savedText = raw;
      } catch { /* ignore */ }
    }
    if (savedText) setTranscribedText(savedText);

    // 读取任务数据
    try {
      const raw = localStorage.getItem("currentTask");
      if (raw) {
        taskRef.current = JSON.parse(raw);
        hasData = true;
      }
    } catch { /* ignore */ }

    // 判断是否从 session 直接进入
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
              localStorage.setItem("currentTask", JSON.stringify({
                ...item.task,
                id: item.task.id ?? item.task.scenario_id ?? 0,
              }));
              setHasHistory(false);

              const raw = localStorage.getItem("diagnosis");
              const gapList = parseDiagnosisGaps(raw);
              setGaps(gapList);
            }}
          />
        </div>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */

  // ---- 无诊断数据 ----
  if (!Array.isArray(gaps) || gaps.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-card-foreground">
          诊断完成
        </h1>
        {diagnosisNote ? (
          <p className="mt-2 text-sm text-muted-foreground">{diagnosisNote}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              暂无诊断数据
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              请先在「初次产出」页面完成对话练习并提交诊断
            </p>
          </>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => router.push("/attempt1")}>
            前往初次产出 →
          </Button>
          <Button variant="outline" onClick={() => router.push("/facilitate")}>
            前往促成学习 →
          </Button>
        </div>
      </div>
    );
  }

  // ---- 诊断结果正常渲染 ----
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* 页面标题 */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          初次产出诊断报告
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          以下是你的核心不足，共 {gaps.length} 项
        </p>
      </header>

      {/* 系统识别的转写文本 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-card-foreground mb-2">
          系统识别到您说了：
        </h3>
        <div className="rounded-md bg-gray-100 dark:bg-gray-800 p-3">
          {transcribedText ? (
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
              {transcribedText}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic font-mono">
              （未获取到语音内容）
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground/60">
          上方为 Whisper 语音识别转写结果。若与您实际说话内容不符，诊断可能不准确。
        </p>
      </div>

      {/* Gap 卡片列表 */}
      <div className="space-y-4">
        {gaps.map((gap, i) => (
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
                {gap.label ?? `不足项 ${i + 1}`}
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

      {/* 底部按钮 */}
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
