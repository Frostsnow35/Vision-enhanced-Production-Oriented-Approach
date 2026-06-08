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

export default function TaskPage() {
  const router = useRouter();
  const { scenarioResult, setScenarioResult } = usePOA();
  const [showDetails, setShowDetails] = useState(false);

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
      <div className="card relative overflow-hidden p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="relative space-y-6">
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
                <div className="space-y-3">
                  {task.goal.split(/(\d+\.\s*)/).filter(Boolean).map((part, index) => {
                    const match = part.match(/^(\d+)\.\s*/);
                    if (match) {
                      return <span key={index} className="font-medium text-primary">{match[1]}.</span>;
                    }
                    const englishMatch = part.match(/^([A-Za-z].*?)(?=\s*[。.，,])/);
                    const chinesePart = part.replace(/^[A-Za-z].*?[。.，,]\s*/, '').trim();
                    return (
                      <div key={index} className="flex flex-col gap-1">
                        <p className="text-sm leading-relaxed text-card-foreground">{englishMatch?.[1] || part}</p>
                        {chinesePart && <p className="text-xs leading-relaxed text-muted-foreground">{chinesePart}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 详情折叠切换 */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <span>约束条件与评价标准</span>
              <svg
                className={`size-4 transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* 可折叠详情区 */}
            {showDetails && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* 语境提示 */}
                {task.context && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      语境提示
                    </h3>
                    <div className="rounded-lg bg-muted/50 p-4">
                      <p className="text-sm leading-relaxed text-muted-foreground">{task.context}</p>
                    </div>
                  </div>
                )}

                {/* 成功标准 */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    成功标准
                  </h3>
                  <div className="card p-4">
                    <p className="text-sm leading-relaxed text-card-foreground">{task.evaluation_criteria}</p>
                  </div>
                </div>
              </div>
            )}
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
  );
}
