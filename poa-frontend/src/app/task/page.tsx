"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePOA } from "@/lib/store";

/* ============================================================
   解析 roles 字段，提取我方角色与 AI 角色
   输入示例：
     "A: 顾客（Customer）—— 有乳糖不耐受; B: 咖啡师（Barista）—— 高峰期忙碌"
   输出：
     { user: "顾客（Customer）—— 有乳糖不耐受", ai: "咖啡师（Barista）—— 高峰期忙碌" }
   ============================================================ */
function parseRoles(raw: string): { user: string; ai: string } {
  // 按 "B:" / "；B:" / "; B:" 等分隔符拆分
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  const partA = parts[0]?.replace(/^A[:：]\s*/i, "").trim() ?? raw;
  const partB = parts[1]?.trim() ?? "";

  return {
    user: partA || "（未指定）",
    ai: partB || "（未指定）",
  };
}

/* ============================================================
   页面组件
   ============================================================ */
export default function TaskPage() {
  const router = useRouter();
  const { scenarioResult } = usePOA();

  // ---- 空状态：未接收到任务数据 ----
  if (!scenarioResult) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-muted">
          <svg
            className="size-8 text-muted-foreground/50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-card-foreground">
          未找到任务
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          请先在「场景驱动」页面选择或上传一张场景照片，系统分析后将自动生成交际任务。
        </p>
        <Button className="mt-6" variant="outline" onClick={() => router.push("/scenario")}>
          ← 返回场景驱动
        </Button>
      </div>
    );
  }

  // 优先用独立字段，兜底解析旧 roles
  const userRole = scenarioResult.user_role?.trim() || parseRoles(scenarioResult.roles).user;
  const aiRole = scenarioResult.ai_role?.trim() || parseRoles(scenarioResult.roles).ai;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- 页面标题 ---- */}
      <header>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {scenarioResult.scene_label}
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          交际任务
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          基于场景分析结果，明确本次交际任务的目标与要求
        </p>
      </header>

      {/* ---- 角色双栏 ---- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <RoleCard
          label="你的角色"
          icon={UserIcon}
          content={userRole}
          variant="user"
        />
        <RoleCard
          label="对话方"
          icon={AiIcon}
          content={aiRole}
          variant="ai"
        />
      </div>

      {/* ---- 任务详情卡片 ---- */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {/* 交际目标 */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <TargetIcon />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                交际目标
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-card-foreground">
                {scenarioResult.goal}
              </p>
            </div>
          </div>
        </div>

        {/* 语境限制 */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
              <ConstraintIcon />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                语境限制
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-card-foreground">
                {scenarioResult.context_constraints}
              </p>
            </div>
          </div>
        </div>

        {/* 评价标准 */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <ChecklistIcon />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                评价标准
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-card-foreground">
                {scenarioResult.evaluation_criteria}
              </p>
            </div>
          </div>
        </div>

        {/* 变体情节（折叠展示） */}
        {scenarioResult.variant_plot && (
          <div className="px-6 py-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400">
                <VariantIcon />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  难度变体
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-card-foreground">
                  {scenarioResult.variant_plot}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- 底部操作 ---- */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-6 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          准备就绪，开始你的第一次英语产出
        </p>
        <Button
          size="lg"
          onClick={() => {
            localStorage.setItem("currentTask", JSON.stringify({
              ...scenarioResult,
              id: scenarioResult.scenario_id ?? 0,
            }));
            router.push("/attempt1");
          }}
        >
          开始初次产出 →
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   角色卡片
   ============================================================ */
function RoleCard({
  label,
  icon: Icon,
  content,
  variant,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: string;
  variant: "user" | "ai";
}) {
  const bg =
    variant === "user"
      ? "from-blue-50 to-indigo-50 dark:from-blue-950/60 dark:to-indigo-950/60 border-blue-100 dark:border-blue-900/40"
      : "from-rose-50 to-orange-50 dark:from-rose-950/60 dark:to-orange-950/60 border-rose-100 dark:border-rose-900/40";

  return (
    <div
      className={`rounded-xl border bg-linear-to-br ${bg} p-5 shadow-sm`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-background/80">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-sm font-medium text-card-foreground">
            {content.split("——")[0]?.trim() ?? content}
          </p>
          {content.includes("——") && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {content.split("——").slice(1).join("——")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   内联图标组件
   ============================================================ */
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="10" r="1.5" />
      <circle cx="15" cy="10" r="1.5" />
      <path d="M9 15c.83.67 1.83 1 3 1s2.17-.33 3-1" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function ConstraintIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function VariantIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2M22 12h-2M12 2v2M12 22v-2" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
