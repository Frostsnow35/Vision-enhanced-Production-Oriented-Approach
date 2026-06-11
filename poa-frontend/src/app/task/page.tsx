"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usePOA, getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";

/* ============================================================
   解析 roles 字段，提取我方角色与 AI 角色
   输入示例：
     "A: 顾客（Customer）—— 有乳糖不耐受; B: 咖啡师（Barista）—— 高峰期忙碌"
   输出：
     { user: "顾客（Customer）—— 有乳糖不耐受", ai: "咖啡师（Barista）—— 高峰期忙碌" }
   ============================================================ */
function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  return {
    user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || "未指定",
    ai: parts[1]?.trim() || "未指定",
  };
}

function splitTaskText(raw?: string): string[] {
  if (!raw) return [];

  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/\s*([;；])\s*/g, "\n")
    .replace(/\s*(\d+)\.\s*/g, "\n$1. ")
    .replace(/\s*(\d+)\)\s*/g, "\n$1) ")
    .trim();

  const parts = normalized
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [raw];
}

function TaskTextBlock({
  text,
  tone = "default",
}: {
  text?: string;
  tone?: "default" | "muted";
}) {
  const items = splitTaskText(text);
  const textClass =
    tone === "muted" ? "text-muted-foreground" : "text-card-foreground";

  if (items.length <= 1) {
    return <p className={`text-sm leading-7 whitespace-pre-line ${textClass}`}>{text}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 20)}`} className="flex gap-2 text-sm leading-7">
          <span className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === "muted" ? "bg-muted-foreground/50" : "bg-primary/60"}`} />
          <span className={textClass}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TaskPage() {
  const router = useRouter();
  const { scenarioResult, setScenarioResult } = usePOA();

  // ---- 初始化状态 ----
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [localTask, setLocalTask] = useState<any>(null);

  useEffect(() => {
    // 如果 POA Context 中已有 scenarioResult，直接使用
    if (scenarioResult) {
      markTaskSelectedInSession();
      setInitDone(true);
      return;
    }

    // POA Context 没有数据，检查 sessionStorage
    if (isTaskSelectedInSession()) {
      // 正常导航过来的情况：从 localStorage 恢复
      const stored = localStorage.getItem("currentTask");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setScenarioResult(parsed);
          setLocalTask(parsed);
        } catch { /* ignore */ }
      }
      setHasHistory(false);
      setInitDone(true);
      return;
    }

    // 刷新/重新进入的情况：显示选择器
    const history = getScenarioHistory();
    setHasHistory(history.length > 0);
    setInitDone(true);
  }, [scenarioResult, setScenarioResult]);

  // 优先使用 POA Context 的数据，其次使用本地恢复的数据
  const task = scenarioResult || localTask;

  if (!initDone) {
    return (
      <div className="mx-auto max-w-2xl py-8 flex items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // ---- 有历史任务 → 显示选择器 ----
  if (hasHistory) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <HistoryTaskSelector
          onSelected={(item: ScenarioHistoryItem) => {
            setScenarioResult(item.task);
            markTaskSelectedInSession();
          }}
        />
      </div>
    );
  }

  // ---- 无任务数据 → 提示返回场景页 ----
  if (!task) {
    return (
      <div className="mx-auto max-w-2xl py-8 text-center">
        <h2 className="text-xl font-bold text-card-foreground">未找到任务</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          请先在场景驱动页面选择或上传场景照片
        </p>
        <Button className="mt-6" variant="outline" onClick={() => router.push("/scenario")}>
          ← 返回场景驱动
        </Button>
      </div>
    );
  }

  const { user, ai } = parseRoles(task.roles);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
            交际任务卡
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/scenario")}
          >
            切换场景
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          请仔细阅读任务要求，然后开始初次产出
        </p>
      </div>

      {/* 场景卡片 */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="relative space-y-6 p-6">
          {/* 场景标签 */}
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              {task.scene_label}
            </span>
          </div>

          {/* 场景描述 */}
          <div className="space-y-4">
            {/* 角色 */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                角色设定
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    你扮演
                  </p>
                  <p className="mt-1 text-sm font-medium text-card-foreground">{user}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    AI 扮演
                  </p>
                  <p className="mt-1 text-sm font-medium text-card-foreground">{ai}</p>
                </div>
              </div>
            </div>

            {/* 交际目标 */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                交际目标
              </h3>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <TaskTextBlock text={task.goal} />
              </div>
            </div>

            {/* 语境提示 */}
            {task.context && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  语境提示
                </h3>
                <div className="rounded-lg bg-muted/50 p-4">
                  <TaskTextBlock text={task.context} tone="muted" />
                </div>
              </div>
            )}

            {/* 成功标准 */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                成功标准
              </h3>
              <div className="rounded-lg border border-border bg-card p-4">
                <TaskTextBlock text={task.evaluation_criteria} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 开始按钮 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-card-foreground">准备就绪？</h3>
          <p className="text-xs text-muted-foreground">
            点击按钮开始与 AI 进行对话练习，系统将实时记录你的表现
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            className="shrink-0 gap-2"
            onClick={() => router.push("/attempt1")}
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            开始初次产出
          </Button>
        </div>
      </div>
    </div>
  );
}
