"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
  const [gaps, setGaps] = useState<GapItem[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const data = JSON.parse(raw);
        // diagnosis 存储的是 { gaps: [...] } 或直接是 gaps 数组
        const gapList: GapItem[] = Array.isArray(data) ? data : data.gaps ?? [];
        setGaps(gapList);
      }
    } catch {
      setGaps([]);
    }
  }, []);

  // ---- 空状态 ----
  if (gaps === null) {
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
          未找到诊断数据
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          请先完成初次产出并提交诊断
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={() => router.push("/attempt1")}
        >
          ← 返回初次产出
        </Button>
      </div>
    );
  }

  if (gaps.length === 0) {
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
