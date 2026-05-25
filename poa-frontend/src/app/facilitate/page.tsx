"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/* ============================================================
   类型 & Mock 数据
   ============================================================ */
interface GapItem {
  label: string;
  evidence_sentence: string | null;
  explanation: string | null;
}

interface PhraseItem {
  function: string;
  sentence: string;
}

interface Exercise {
  id: number;
  context: string;
  options: { key: string; text: string }[];
  answer: string;
  explanation: string;
}

// 默认学习材料（后续可替换为后端 API 调用）
const DEFAULT_PHRASES: PhraseItem[] = [
  {
    function: "礼貌请求",
    sentence: "I'd like a large latte, please.",
  },
  {
    function: "委婉询问",
    sentence: "Could I have that with oat milk instead?",
  },
  {
    function: "确认信息",
    sentence: "So that's a medium iced latte — correct?",
  },
  {
    function: "回应提议",
    sentence: "Yes, for here, please. / To go, thanks.",
  },
  {
    function: "表达感谢",
    sentence: "Thank you so much! Have a great day!",
  },
  {
    function: "请求重复",
    sentence: "Sorry, could you say that again?",
  },
];

const DEFAULT_DIALOGUE = {
  title: "咖啡店点单 — 示范对话",
  lines: [
    { speaker: "Barista", text: "Hi there! What can I get for you today?" },
    {
      speaker: "Customer",
      text: "Hi! I'd like a medium iced latte, please.",
    },
    { speaker: "Barista", text: "Sure. For here or to go?" },
    { speaker: "Customer", text: "For here, thanks." },
    { speaker: "Barista", text: "Anything else?" },
    {
      speaker: "Customer",
      text: "Actually, could I have that with oat milk? I'm lactose intolerant.",
    },
    {
      speaker: "Barista",
      text: "Of course! We can do that. That'll be $5.50.",
    },
    { speaker: "Customer", text: "Great, here's my card." },
    {
      speaker: "Barista",
      text: "Thanks. Your order will be ready in just a few minutes.",
    },
    { speaker: "Customer", text: "Thank you so much!" },
  ],
};

const DEFAULT_EXERCISES: Exercise[] = [
  {
    id: 1,
    context:
      "你走进一家咖啡店，想点一杯大杯冰拿铁并把牛奶换成燕麦奶。你应该怎么说？",
    options: [
      { key: "A", text: "I want a large iced latte. No milk." },
      {
        key: "B",
        text: "I'd like a large iced latte with oat milk, please.",
      },
      { key: "C", text: "Give me a large latte with oat milk." },
    ],
    answer: "B",
    explanation:
      "B 使用 'I'd like...' + 'please'，是最礼貌得体的表达。A 的 'No milk' 会让人误以为要黑咖啡；C 的祈使句 'Give me' 过于直接生硬。",
  },
  {
    id: 2,
    context:
      "咖啡师问 'For here or to go?'，你想在这里喝。以下哪种回应最自然？",
    options: [
      { key: "A", text: "Here." },
      { key: "B", text: "I'll stay here." },
      { key: "C", text: "For here, please." },
    ],
    answer: "C",
    explanation:
      "C 重复关键词 'for here' 表示确认，并加上 'please' 保持礼貌。A 太简短冷淡；B 的 'stay here' 意思不准确。",
  },
  {
    id: 2,
    context:
      "你没听清咖啡师说的话，想请对方重复一遍。你应该怎么说？",
    options: [
      { key: "A", text: "What?" },
      { key: "B", text: "Can you say it again?" },
      { key: "C", text: "Sorry, could you say that again, please?" },
    ],
    answer: "C",
    explanation:
      "C 用 'Sorry' 开头表达歉意，用 'Could' 表示礼貌请求，结尾加 'please'。A 的 'What?' 很粗鲁；B 虽然是完整的句子但缺少礼貌标记。",
  },
];

/* ============================================================
   页面组件
   ============================================================ */
export default function FacilitatePage() {
  const router = useRouter();

  // ---- 诊断数据 ----
  const [gaps, setGaps] = useState<GapItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const data = JSON.parse(raw);
        setGaps(Array.isArray(data) ? data : data.gaps ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  // ---- Tab ----
  const [tab, setTab] = useState<"phrases" | "dialogue" | "exercises">("phrases");

  // ---- 练习状态: { [exerciseId]: { selected: string | null; revealed: boolean } } ----
  const [exerciseState, setExerciseState] = useState<
    Record<number, { selected: string | null; revealed: boolean }>
  >({});

  function selectOption(exId: number, key: string) {
    setExerciseState((prev) => ({
      ...prev,
      [exId]: { selected: key, revealed: true },
    }));
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- 页面标题 ---- */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          促成学习
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          针对性输入与即时练习
          {gaps.length > 0 && (
            <span className="ml-2 text-xs">
              — 基于 {gaps.length} 项诊断不足
            </span>
          )}
        </p>
      </header>

      {/* ---- 诊断摘要 ---- */}
      {gaps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gaps.map((g, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
            >
              {g.label}
            </span>
          ))}
        </div>
      )}

      {/* ---- Tab 切换 ---- */}
      <div className="flex border-b border-border">
        {([
          ["phrases", "场景词块与句式"],
          ["dialogue", "示范对话"],
          ["exercises", "即时练习"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-card-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- 内容区域 ---- */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {tab === "phrases" && <PhrasesTab phrases={DEFAULT_PHRASES} />}
        {tab === "dialogue" && <DialogueTab dialogue={DEFAULT_DIALOGUE} />}
        {tab === "exercises" && (
          <ExercisesTab
            exercises={DEFAULT_EXERCISES}
            state={exerciseState}
            onSelect={selectOption}
          />
        )}
      </div>

      {/* ---- 底部操作 ---- */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-6 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          完成学习后，用改进的表达进行第二次产出
        </p>
        <Button size="lg" onClick={() => router.push("/attempt2")}>
          完成学习，进入二次产出 →
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Tab1: 场景词块与句式
   ============================================================ */
function PhrasesTab({ phrases }: { phrases: PhraseItem[] }) {
  return (
    <div className="space-y-1">
      {phrases.map((p, i) => (
        <div
          key={i}
          className="flex items-start gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {p.function}
          </span>
          <code className="text-sm font-medium text-card-foreground">
            {p.sentence}
          </code>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Tab2: 示范对话
   ============================================================ */
function DialogueTab({
  dialogue,
}: {
  dialogue: { title: string; lines: { speaker: string; text: string }[] };
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {dialogue.title}
      </h3>
      <div className="rounded-lg bg-muted/40 p-5 space-y-3">
        {dialogue.lines.map((line, i) => {
          const isStaff = line.speaker === "Barista";
          return (
            <div
              key={i}
              className={`flex ${isStaff ? "justify-start" : "justify-end"}`}
            >
              <div className="max-w-[80%] space-y-0.5">
                <p className="text-[10px] font-semibold text-muted-foreground">
                  {line.speaker}
                </p>
                <p
                  className={`rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    isStaff
                      ? "bg-muted text-card-foreground rounded-bl-md"
                      : "bg-primary/10 text-card-foreground rounded-br-md"
                  }`}
                >
                  {line.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Tab3: 即时练习
   ============================================================ */
function ExercisesTab({
  exercises,
  state,
  onSelect,
}: {
  exercises: Exercise[];
  state: Record<number, { selected: string | null; revealed: boolean }>;
  onSelect: (exId: number, key: string) => void;
}) {
  return (
    <div className="space-y-8">
      {exercises.map((ex, i) => {
        const exState = state[ex.id];
        const selected = exState?.selected ?? null;
        const revealed = exState?.revealed ?? false;
        const isCorrect = revealed && selected === ex.answer;

        return (
          <div key={ex.id} className="space-y-4">
            {/* 题号 + 语境 */}
            <div>
              <span className="text-xs font-semibold text-muted-foreground">
                第 {i + 1} 题
              </span>
              <p className="mt-1 text-sm text-card-foreground">{ex.context}</p>
            </div>

            {/* 选项 */}
            <div className="space-y-2">
              {ex.options.map((opt) => {
                let borderClass = "border-border hover:border-muted-foreground/40";
                if (revealed) {
                  if (opt.key === ex.answer) {
                    borderClass =
                      "border-green-500/50 bg-green-50 dark:bg-green-950/20";
                  } else if (opt.key === selected) {
                    borderClass =
                      "border-destructive/50 bg-destructive/10";
                  }
                }

                return (
                  <button
                    key={opt.key}
                    disabled={revealed}
                    onClick={() => onSelect(ex.id, opt.key)}
                    className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${borderClass}`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium">
                      {opt.key}
                    </span>
                    <span className="text-card-foreground">{opt.text}</span>
                  </button>
                );
              })}
            </div>

            {/* 反馈 */}
            {revealed && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  isCorrect
                    ? "border-green-500/30 bg-green-50/60 dark:bg-green-950/20"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <p
                  className={`font-semibold ${
                    isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"
                  }`}
                >
                  {isCorrect ? "✓ 正确" : "✗ 错误"}
                </p>
                <p className="mt-1 text-muted-foreground">{ex.explanation}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
