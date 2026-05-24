"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  generateInputPack,
  generateExercises,
  type GapItem,
  type InputPackResult,
  type ExerciseItem,
} from "@/lib/api";
import { usePOA } from "@/lib/store";
import { GapList } from "@/components/GapList";

export default function FacilitatePage() {
  const router = useRouter();
  const { attempt1Gaps, inputPack, exercises, setInputPack, setExercises } =
    usePOA();

  const [pack, setPack] = useState<InputPackResult | null>(inputPack);
  const [exs, setExs] = useState<ExerciseItem[]>(exercises.length ? exercises : []);
  const [packLoading, setPackLoading] = useState(false);
  const [exLoading, setExLoading] = useState(false);
  const [error, setError] = useState("");

  // 如果没有 gaps，使用模拟数据确保可以演示
  const activeGaps: GapItem[] =
    attempt1Gaps.length > 0
      ? attempt1Gaps
      : [
          {
            label: "语法-情态动词缺失",
            evidence_sentence: "I want a large latte.",
            explanation: "建议使用 'I'd like...' 代替 'I want...'",
          },
        ];

  async function handleGeneratePack() {
    setError("");
    setPackLoading(true);
    try {
      const result = await generateInputPack(activeGaps);
      setPack(result);
      setInputPack(result);
    } catch (err: any) {
      setError("生成材料失败: " + err.message);
    } finally {
      setPackLoading(false);
    }
  }

  async function handleGenerateExercises() {
    setError("");
    setExLoading(true);
    try {
      const result = await generateExercises(activeGaps);
      setExs(result.exercises);
      setExercises(result.exercises);
    } catch (err: any) {
      setError("生成练习失败: " + err.message);
    } finally {
      setExLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
          促成学习
        </h1>
        <p className="mt-2 text-muted-foreground">
          针对初次产出中的不足，AI 生成学习材料与练习题，帮你搭建语言支架。
        </p>
      </div>

      {/* Gaps 回顾 */}
      <GapList gaps={activeGaps} attempt={1} />

      {/* 生成按钮 */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={handleGeneratePack} disabled={packLoading} variant="secondary">
          {packLoading ? "生成中..." : "生成学习材料包"}
        </Button>
        <Button onClick={handleGenerateExercises} disabled={exLoading} variant="secondary">
          {exLoading ? "生成中..." : "生成练习题"}
        </Button>
        {(pack || exs.length > 0) && (
          <Button onClick={() => router.push("/attempt2")}>
            去二次产出 →
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 学习材料包 */}
      {pack && <InputPackCard pack={pack} />}

      {/* 练习题 */}
      {exs.length > 0 && <ExerciseList exercises={exs} />}
    </div>
  );
}

// ---- 学习材料包卡片 ----
function InputPackCard({ pack }: { pack: InputPackResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-6">
      <h2 className="text-xl font-semibold text-card-foreground">学习材料包</h2>

      {/* 场景语块 */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          场景语块
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {pack.scene_chunks.map((c, i) => (
            <div key={i} className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium text-card-foreground">{c.chunk}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.meaning}</p>
              <p className="text-xs text-muted-foreground">{c.usage}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 功能句 */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          功能句型
        </h3>
        <div className="space-y-2">
          {pack.functional_sentences.map((s, i) => (
            <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
              <span className="shrink-0 text-xs font-medium text-muted-foreground w-28">
                {s.function}
              </span>
              <span className="text-sm text-card-foreground font-medium">{s.sentence}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 示范对话 */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          示范对话
        </h3>
        <pre className="whitespace-pre-line rounded-md border border-border bg-muted/30 p-3 text-sm text-card-foreground">
          {pack.demo_dialogue}
        </pre>
      </div>

      {/* 策略提示 */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          策略提示
        </h3>
        <pre className="whitespace-pre-line rounded-md border border-border bg-muted/30 p-3 text-sm text-card-foreground">
          {pack.strategy_tip}
        </pre>
      </div>
    </div>
  );
}

// ---- 练习题列表 ----
function ExerciseList({ exercises }: { exercises: ExerciseItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-6">
      <h2 className="text-xl font-semibold text-card-foreground">
        练习题（{exercises.length} 题）
      </h2>
      {exercises.map((ex) => (
        <ExerciseCard key={ex.id} exercise={ex} />
      ))}
    </div>
  );
}

function ExerciseCard({ exercise }: { exercise: ExerciseItem }) {
  const [revealed, setRevealed] = useState(false);
  const [userAnswer, setUserAnswer] = useState("");

  const isCorrect = revealed && (
    exercise.type === "multiple_choice"
      ? userAnswer === exercise.answer
      : userAnswer.trim().toLowerCase() === exercise.answer.toLowerCase()
  );

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {exercise.type === "multiple_choice" ? "选择题" : "填空题"}
        </span>
        <span className="text-xs text-muted-foreground">针对: {exercise.gap_target}</span>
      </div>

      <p className="text-sm text-card-foreground whitespace-pre-line">{exercise.question}</p>

      {/* 选择题 */}
      {exercise.type === "multiple_choice" && (
        <div className="space-y-1.5">
          {exercise.options.map((opt) => (
            <label
              key={opt.key}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                !revealed
                  ? "hover:bg-muted"
                  : opt.key === exercise.answer
                  ? "border-green-500/50 bg-green-50 dark:bg-green-950/20"
                  : userAnswer === opt.key && !isCorrect
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-border"
              }`}
            >
              <input
                type="radio"
                name={`ex-${exercise.id}`}
                value={opt.key}
                disabled={revealed}
                onChange={(e) => setUserAnswer(e.target.value)}
                className="size-3.5 accent-primary"
              />
              <span className="font-medium">{opt.key}.</span>
              <span>{opt.text}</span>
            </label>
          ))}
        </div>
      )}

      {/* 填空题 */}
      {exercise.type === "fill_in_blank" && (
        <input
          type="text"
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          disabled={revealed}
          placeholder="在此输入答案..."
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${
            revealed
              ? isCorrect
                ? "border-green-500/50 bg-green-50 dark:bg-green-950/20"
                : "border-destructive/50 bg-destructive/10"
              : "border-border focus:border-ring"
          }`}
        />
      )}

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!userAnswer || revealed}
          onClick={() => setRevealed(true)}
        >
          检查答案
        </Button>
        {revealed && (
          <span className={`text-sm font-medium ${isCorrect ? "text-green-600" : "text-destructive"}`}>
            {isCorrect ? "正确!" : "再想想"}
          </span>
        )}
      </div>

      {revealed && (
        <div className="rounded-md border border-border bg-background p-3 space-y-1">
          <p className="text-sm">
            <span className="font-medium text-card-foreground">正确答案: </span>
            <span className="text-green-600 dark:text-green-400 font-medium">{exercise.answer}</span>
          </p>
          <p className="text-sm text-muted-foreground">{exercise.feedback}</p>
        </div>
      )}
    </div>
  );
}
