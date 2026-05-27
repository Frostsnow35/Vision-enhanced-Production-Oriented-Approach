"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { evaluateAttempts, type EvaluateResult } from "@/lib/api";
import { usePOA } from "@/lib/store";

const DIM_LABELS: Record<string, string> = {
  fluency: "流利度",
  accuracy: "语法准确性",
  pragmatics: "语用得体性",
  complexity: "句式复杂度",
  task_completion: "任务完成度",
  vocabulary: "词汇丰富度",
  pronunciation_intonation: "发音语调",
};

export default function EvaluatePage() {
  const router = useRouter();
  const {
    attempt1Text,
    attempt2Text,
    evaluateResult,
    setEvaluateResult,
  } = usePOA();

  const [text1, setText1] = useState(attempt1Text || "");
  const [text2, setText2] = useState(attempt2Text || "");
  const [result, setResult] = useState<EvaluateResult | null>(evaluateResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleEvaluate() {
    if (!text1.trim() || !text2.trim()) {
      setError("请填写两次作答文本");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const r = await evaluateAttempts(text1.trim(), text2.trim());
      setResult(r);
      setEvaluateResult(r);
    } catch (err: any) {
      setError("评价失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
          双轨评价
        </h1>
        <p className="mt-2 text-muted-foreground">
          对比改进前后两次作答，七维度评分并生成综合评价报告。
        </p>
      </div>

      {/* 输入区域 */}
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-4">
        <div>
          <label className="text-sm font-medium text-card-foreground">
            第一次作答（改进前）
          </label>
          <textarea
            value={text1}
            onChange={(e) => setText1(e.target.value)}
            rows={3}
            placeholder="输入第一次作答文本..."
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">
            第二次作答（改进后）
          </label>
          <textarea
            value={text2}
            onChange={(e) => setText2(e.target.value)}
            rows={3}
            placeholder="输入第二次作答文本..."
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
          />
        </div>
        <Button onClick={handleEvaluate} disabled={loading || !text1.trim() || !text2.trim()}>
          {loading ? "评价中..." : "开始评价"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* 评价结果 */}
      {result && (
        <div className="space-y-6">
          {/* 七维度雷达对比 */}
          <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold text-card-foreground">
              七维度双轨评分
            </h2>
            <div className="space-y-3">
              {Object.entries(result.dimension_scores).map(([key, score]) => {
                const diff = score.attempt2 - score.attempt1;
                const pct1 = score.attempt1;
                const pct2 = score.attempt2;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-card-foreground">
                        {DIM_LABELS[key] ?? key}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {score.attempt1} → {score.attempt2}
                        <span className={`ml-2 font-semibold ${diff >= 0 ? "text-green-600" : "text-destructive"}`}>
                          {diff >= 0 ? "+" : ""}{diff}
                        </span>
                      </span>
                    </div>
                    <div className="flex h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="bg-primary/60 transition-all"
                        style={{ width: `${pct1}%` }}
                      />
                      <div className="w-1 bg-background" />
                      <div
                        className="bg-primary transition-all"
                        style={{ width: `${pct2}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>A1</span>
                      <span>A2</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 改善情况 */}
          <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-3">
            <h2 className="text-xl font-semibold text-card-foreground">
              问题改善情况
            </h2>
            <pre className="whitespace-pre-line text-sm text-card-foreground">
              {result.problem_improved}
            </pre>
          </div>

          {/* 完整报告 */}
          <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-3">
            <h2 className="text-xl font-semibold text-card-foreground">
              综合评价报告
            </h2>
            <pre className="whitespace-pre-line text-sm text-card-foreground">
              {result.full_report}
            </pre>
          </div>

          <div className="text-center">
            <Button variant="outline" onClick={() => router.push("/")}>
              返回首页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
