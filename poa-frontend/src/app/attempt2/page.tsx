"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diagnoseAttempt, type GapItem } from "@/lib/api";
import { usePOA } from "@/lib/store";
import { GapList } from "@/components/GapList";

export default function Attempt2Page() {
  const router = useRouter();
  const {
    attempt2Text,
    attempt2Gaps,
    inputPack,
    setAttempt2,
  } = usePOA();

  const [text, setText] = useState(attempt2Text || "");
  const [gaps, setGaps] = useState<GapItem[]>(attempt2Gaps.length ? attempt2Gaps : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!text.trim()) {
      setError("请输入作答文本");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await diagnoseAttempt(text.trim());
      setGaps(result.gaps);
      setAttempt2(text.trim(), result.gaps);
    } catch (err: any) {
      setError("诊断失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
          二次产出
        </h1>
        <p className="mt-2 text-muted-foreground">
          结合学习材料与策略提示，用改进后的英语再次作答。
        </p>
      </div>

      {/* 参考材料提示 */}
      {inputPack && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-card-foreground">
            提示：可利用以下策略改进表达
          </p>
          <pre className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
            {inputPack.strategy_tip}
          </pre>
        </div>
      )}

      {/* 输入区域 */}
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-4">
        <label className="text-sm font-medium text-card-foreground">
          改进后的作答（英语）
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="例如：I'd like a large iced latte with oat milk, please..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
        />
        <div className="flex gap-3">
          <Button onClick={handleSubmit} disabled={loading || !text.trim()}>
            {loading ? "诊断中..." : "提交诊断"}
          </Button>
          {gaps.length > 0 && (
            <Button variant="outline" onClick={() => router.push("/evaluate")}>
              去评价 →
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Gap 展示 */}
      {gaps.length > 0 && <GapList gaps={gaps} attempt={2} />}
    </div>
  );
}
