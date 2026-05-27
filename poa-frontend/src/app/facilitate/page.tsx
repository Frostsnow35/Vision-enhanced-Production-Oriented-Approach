"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import * as echarts from "echarts";

/* ============================================================
   类型 & 常量
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

// 七维评价体系（与后端的 7 个维度严格一致）
type DimScores = Record<string, number>;

const DIM_ORDER = [
  "发音标准度",
  "语法规范性",
  "词汇适配性",
  "语言功能达成度",
  "语用策略得体性",
  "话语回合适配性",
  "副语言匹配度",
];

const DIM_ADVICE: Record<string, string> = {
  "发音标准度": "多听示范音频跟读，重点练习元音饱满度和词尾辅音，可使用录音自评。",
  "语法规范性": "重点复习时态、主谓一致和介词搭配，口头练习时注意自我纠正。",
  "词汇适配性": "积累场景核心词汇和固定搭配，用同义替换避免重复使用基础词汇。",
  "语言功能达成度": "先确保完成所有交际要点再追求复杂表达，练习前先列出关键步骤。",
  "语用策略得体性": "学习使用 'I'd like', 'Could you...' 等委婉表达，强化礼貌标记词。",
  "话语回合适配性": "练习使用 'Well', 'Actually', 'Sure' 等话语标记自然开启回应，注意话轮交替节奏。",
  "副语言匹配度": "注意疑问句升调和陈述句降调，练习语速变化和情感语调，可跟读示范音频。",
};

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// Mock 七维分数（/api/evaluate-single 不可用时的降级）
const MOCK_SCORES: DimScores = {
  "发音标准度": 2.5,
  "语法规范性": 2.0,
  "词汇适配性": 1.5,
  "语言功能达成度": 3.0,
  "语用策略得体性": 1.5,
  "话语回合适配性": 2.0,
  "副语言匹配度": 3.0,
};

/* ============================================================
   Mock 学习材料
   ============================================================ */
const DEFAULT_PHRASES: PhraseItem[] = [
  { function: "礼貌请求", sentence: "I'd like a large latte, please." },
  { function: "委婉询问", sentence: "Could I have that with oat milk instead?" },
  { function: "确认信息", sentence: "So that's a medium iced latte — correct?" },
  { function: "回应提议", sentence: "Yes, for here, please. / To go, thanks." },
  { function: "表达感谢", sentence: "Thank you so much! Have a great day!" },
  { function: "请求重复", sentence: "Sorry, could you say that again?" },
];

const DEFAULT_DIALOGUE = {
  title: "咖啡店点单 — 示范对话",
  lines: [
    { speaker: "Barista", text: "Hi there! What can I get for you today?" },
    { speaker: "Customer", text: "Hi! I'd like a medium iced latte, please." },
    { speaker: "Barista", text: "Sure. For here or to go?" },
    { speaker: "Customer", text: "For here, thanks." },
    { speaker: "Barista", text: "Anything else?" },
    { speaker: "Customer", text: "Actually, could I have that with oat milk? I'm lactose intolerant." },
    { speaker: "Barista", text: "Of course! We can do that. That'll be $5.50." },
    { speaker: "Customer", text: "Great, here's my card." },
    { speaker: "Barista", text: "Thanks. Your order will be ready in just a few minutes." },
    { speaker: "Customer", text: "Thank you so much!" },
  ],
};

const DEFAULT_EXERCISES: Exercise[] = [
  {
    id: 1,
    context: "你走进一家咖啡店，想点一杯大杯冰拿铁并把牛奶换成燕麦奶。你应该怎么说？",
    options: [
      { key: "A", text: "I want a large iced latte. No milk." },
      { key: "B", text: "I'd like a large iced latte with oat milk, please." },
      { key: "C", text: "Give me a large latte with oat milk." },
    ],
    answer: "B",
    explanation: "B 使用 'I'd like...' + 'please'，是最礼貌得体的表达。A 的 'No milk' 会让人误以为要黑咖啡；C 的祈使句 'Give me' 过于直接生硬。",
  },
  {
    id: 2,
    context: "咖啡师问 'For here or to go?'，你想在这里喝。以下哪种回应最自然？",
    options: [
      { key: "A", text: "Here." },
      { key: "B", text: "I'll stay here." },
      { key: "C", text: "For here, please." },
    ],
    answer: "C",
    explanation: "C 重复关键词 'for here' 表示确认，并加上 'please' 保持礼貌。A 太简短冷淡；B 的 'stay here' 意思不准确。",
  },
  {
    id: 3,
    context: "你没听清咖啡师说的话，想请对方重复一遍。你应该怎么说？",
    options: [
      { key: "A", text: "What?" },
      { key: "B", text: "Can you say it again?" },
      { key: "C", text: "Sorry, could you say that again, please?" },
    ],
    answer: "C",
    explanation: "C 用 'Sorry' 开头表达歉意，用 'Could' 表示礼貌请求，结尾加 'please'。A 的 'What?' 很粗鲁；B 缺少礼貌标记。",
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
    } catch { /* ignore */ }
  }, []);

  // ---- Tab ----
  type TabKey = "assessment" | "phrases" | "dialogue" | "exercises";
  const [tab, setTab] = useState<TabKey>("assessment");

  // ---- 练习状态 ----
  const [exerciseState, setExerciseState] = useState<
    Record<number, { selected: string | null; revealed: boolean }>
  >({});

  function selectOption(exId: number, key: string) {
    setExerciseState((prev) => ({
      ...prev,
      [exId]: { selected: key, revealed: true },
    }));
  }

  // ---- 能力评估数据 ----
  const [scores, setScores] = useState<DimScores | null>(null);
  const [scoresLoading, setScoresLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // 从 localStorage 读 attempt1 文本
        let text = "";
        try {
          const diagRaw = localStorage.getItem("diagnosis");
          if (diagRaw) {
            const diag = JSON.parse(diagRaw);
            const gapList = Array.isArray(diag) ? diag : diag?.gaps ?? [];
            text = gapList.map((g: any) => g?.evidence_sentence ?? "").filter(Boolean).join(" ");
          }
        } catch { /* ignore */ }

        const res = await fetch(`${BASE_URL}/api/evaluate-single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_text: text || "no text" }),
        });
        if (res.ok) {
          const data = await res.json();
          const rawScores = data?.dimension_scores ?? data;
          // 只保留 DIM_ORDER 中存在的维度
          if (rawScores && typeof rawScores === "object" && Object.keys(rawScores).length > 0) {
            const filtered: DimScores = {};
            for (const dim of DIM_ORDER) {
              if (dim in rawScores) filtered[dim] = Number(rawScores[dim]) || 0;
            }
            setScores(Object.keys(filtered).length > 0 ? filtered : MOCK_SCORES);
          } else {
            throw new Error("empty scores");
          }
        } else {
          throw new Error(`${res.status}`);
        }
      } catch {
        setScores(MOCK_SCORES);
      } finally {
        setScoresLoading(false);
      }
    })();
  }, []);

  /* ---- 找出最低的 2 个维度 ---- */
  const weakDims: string[] = (() => {
    if (!scores) return [];
    const entries = Object.entries(scores).filter(([, v]) => typeof v === "number");
    if (entries.length === 0) return [];
    return entries
      .sort(([, a], [, b]) => a - b)
      .slice(0, 2)
      .map(([k]) => k);
  })();

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- 标题 ---- */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          促成学习
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          能力评估 + 针对性输入 + 即时练习
          {gaps.length > 0 && (
            <span className="ml-2 text-xs">— 基于 {gaps.length} 项诊断不足</span>
          )}
        </p>
      </header>

      {/* ---- 诊断标签 ---- */}
      {gaps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gaps.map((g, i) => (
            <span key={i} className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {g.label}
            </span>
          ))}
        </div>
      )}

      {/* ---- Tab 切换 ---- */}
      <div className="flex flex-wrap border-b border-border">
        {([
          ["assessment", "当前能力评估"],
          ["phrases", "场景词块与句式"],
          ["dialogue", "示范对话"],
          ["exercises", "即时练习"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-card-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- 内容区 ---- */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {tab === "assessment" && (
          <AssessmentTab scores={scores} loading={scoresLoading} weakDims={weakDims} />
        )}
        {tab === "phrases" && <PhrasesTab phrases={DEFAULT_PHRASES} />}
        {tab === "dialogue" && <DialogueTab dialogue={DEFAULT_DIALOGUE} />}
        {tab === "exercises" && (
          <ExercisesTab exercises={DEFAULT_EXERCISES} state={exerciseState} onSelect={selectOption} />
        )}
      </div>

      {/* ---- 底部 ---- */}
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
   Tab0: 当前能力评估（雷达图）
   ============================================================ */
function AssessmentTab({
  scores,
  loading,
  weakDims,
}: {
  scores: DimScores | null;
  loading: boolean;
  weakDims: string[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    // 安全提取数据：按照 DIM_ORDER 顺序排列
    const scoreMap = scores ?? MOCK_SCORES;
    const dims = DIM_ORDER.filter((d) => d in scoreMap);
    const values = dims.map((d) => scoreMap[d] ?? 0);
    const indicator = dims.map((name) => ({ name, min: 1, max: 5 }));
    // 如果没有任何维度数据，使用占位
    if (indicator.length === 0) {
      DIM_ORDER.forEach((d) => indicator.push({ name: d, min: 1, max: 5 }));
      DIM_ORDER.forEach(() => values.push(3));
    }

    const chart = echarts.init(chartRef.current);

    chart.setOption({
      tooltip: { trigger: "item" },
      legend: { show: false },
      radar: {
        center: ["50%", "52%"],
        radius: "65%",
        min: 1,
        max: 5,
        indicator,
        axisName: {
          color: "#64748b",
          fontSize: 12,
        },
        splitArea: {
          areaStyle: { color: ["#f8fafc", "#f1f5f9"] },
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: values,
              name: "你的表现",
              areaStyle: { color: "rgba(59, 130, 246, 0.15)" },
              lineStyle: { color: "#3b82f6", width: 2 },
              itemStyle: {
                color: (params: any) => {
                  const key = dims[params.dataIndex] ?? "";
                  return weakDims.includes(key) ? "#ef4444" : "#3b82f6";
                },
              },
            },
          ],
        },
      ],
    });

    return () => chart.dispose();
  }, [scores, weakDims]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        正在加载能力评估...
      </div>
    );
  }

  if (!scores || Object.keys(scores).length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        暂无评估数据，请先完成初次产出
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div ref={chartRef} style={{ width: "100%", height: 400 }} />

      {weakDims.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-card-foreground">
            需要重点提升的维度
          </h3>
          {weakDims.map((dim) => (
            <div
              key={dim}
              className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-destructive" />
                <span className="text-sm font-semibold text-destructive">
                  {dim}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({(scores[dim] ?? 0).toFixed(1)} / 5.0)
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {DIM_ADVICE[dim] ?? "针对该维度进行专项练习。"}
              </p>
            </div>
          ))}
        </div>
      )}
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
        <div key={i} className="flex items-start gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50">
          <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {p.function}
          </span>
          <code className="text-sm font-medium text-card-foreground">{p.sentence}</code>
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
      <h3 className="text-sm font-semibold text-muted-foreground">{dialogue.title}</h3>
      <div className="rounded-lg bg-muted/40 p-5 space-y-3">
        {dialogue.lines.map((line, i) => (
          <div key={i} className={`flex ${line.speaker === "Barista" ? "justify-start" : "justify-end"}`}>
            <div className="max-w-[80%] space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground">{line.speaker}</p>
              <p
                className={`rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  line.speaker === "Barista"
                    ? "bg-muted text-card-foreground rounded-bl-md"
                    : "bg-primary/10 text-card-foreground rounded-br-md"
                }`}
              >
                {line.text}
              </p>
            </div>
          </div>
        ))}
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
        const revealed = exState?.revealed ?? false;
        const selected = exState?.selected ?? null;
        const isCorrect = revealed && selected === ex.answer;

        return (
          <div key={ex.id} className="space-y-4">
            <div>
              <span className="text-xs font-semibold text-muted-foreground">第 {i + 1} 题</span>
              <p className="mt-1 text-sm text-card-foreground">{ex.context}</p>
            </div>
            <div className="space-y-2">
              {ex.options.map((opt) => {
                let cls = "border-border hover:border-muted-foreground/40";
                if (revealed) {
                  if (opt.key === ex.answer) cls = "border-green-500/50 bg-green-50 dark:bg-green-950/20";
                  else if (opt.key === selected) cls = "border-destructive/50 bg-destructive/10";
                }
                return (
                  <button
                    key={opt.key}
                    disabled={revealed}
                    onClick={() => onSelect(ex.id, opt.key)}
                    className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${cls}`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium">{opt.key}</span>
                    <span className="text-card-foreground">{opt.text}</span>
                  </button>
                );
              })}
            </div>
            {revealed && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                isCorrect ? "border-green-500/30 bg-green-50/60 dark:bg-green-950/20" : "border-destructive/30 bg-destructive/5"
              }`}>
                <p className={`font-semibold ${isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
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
