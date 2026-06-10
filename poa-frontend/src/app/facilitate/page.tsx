"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import InlineLoadingHint from "@/components/InlineLoadingHint";
import { BASE_URL } from "@/lib/api";
import * as echarts from "echarts";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import { isDeviceCheckPassed } from "@/lib/device-check";

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
  gap_target?: string;
}

interface DialogueData {
  title: string;
  lines: { speaker: string; text: string }[];
}

type DimScores = Record<string, number>;

type TabKey = "assessment" | "phrases" | "dialogue" | "exercises" | "oral";

interface LearningProgress {
  tabs: Record<TabKey, "unvisited" | "visited" | "completed">;
  exercisesCompleted: number;
  totalExercises: number;
  startTime: number;
  phrasesLearned: string[];
}

const DIM_ORDER = [
  "发音标准度",
  "语法规范性",
  "词汇适配性",
  "语言功能达成度",
  "语用策略得体性",
  "话语回合适配性",
  "副语言匹配度",
];

const DIM_DESCRIPTIONS: Record<string, { description: string; levels: Record<number, string>; tips: string }> = {
  "发音标准度": {
    description: "评估英语发音的准确程度，包括元音、辅音、重音和语调。",
    levels: {
      1: "发音困难，大量错误，难以理解",
      2: "有明显发音错误，部分可理解",
      3: "基本发音正确，偶有小错误",
      4: "发音清晰准确，自然流畅",
      5: "发音标准，接近母语者水平",
    },
    tips: "多听示范音频，模仿跟读，注意重音和语调，可以录下自己的发音进行对比。",
  },
  "语法规范性": {
    description: "评估语法使用的正确性，包括时态、语态、主谓一致等。",
    levels: {
      1: "语法错误频繁，严重影响理解",
      2: "有较多语法错误，影响表达流畅",
      3: "基本语法正确，偶有小错误",
      4: "语法使用准确，表达流畅",
      5: "语法完美，运用自如",
    },
    tips: "练习时注意自我纠正，建立语法笔记，定期复习巩固。",
  },
  "词汇适配性": {
    description: "评估词汇使用的恰当性、丰富性和准确性。",
    levels: {
      1: "词汇量有限，表达单一",
      2: "基本词汇尚可，表达不够丰富",
      3: "词汇选择适当，能表达基本意思",
      4: "词汇丰富，使用恰当",
      5: "词汇精准，表达地道",
    },
    tips: "建立场景词汇库，学习同义词替换，注意词汇搭配。",
  },
  "语言功能达成度": {
    description: "评估能否用英语完成特定的交际功能，如请求、建议、道歉等。",
    levels: {
      1: "难以完成基本交际功能",
      2: "能部分完成交际功能，但方式有限",
      3: "能完成基本交际功能",
      4: "能有效完成多种交际功能",
      5: "能灵活、自然地完成各种交际功能",
    },
    tips: "明确每种交际功能的常用表达，进行有针对性的练习。",
  },
  "语用策略得体性": {
    description: "评估语言使用的礼貌性、得体性和文化适应性。",
    levels: {
      1: "表达直接生硬，缺乏礼貌",
      2: "有基本礼貌，但不够自然",
      3: "表达礼貌得体",
      4: "表达自然流畅，礼貌得体",
      5: "表达地道，灵活应对各种社交场合",
    },
    tips: "学习委婉表达，注意礼貌用语，了解文化差异。",
  },
  "话语回合适配性": {
    description: "评估对话中的回应能力，包括话题延续和转换。",
    levels: {
      1: "回应困难，难以维持对话",
      2: "能回应，但对话不够自然",
      3: "能自然回应，维持对话",
      4: "回应积极，推动对话发展",
      5: "回应灵活自然，对话流畅高效",
    },
    tips: "练习使用话语标记，注意倾听对方，学会自然地转换话题。",
  },
  "副语言匹配度": {
    description: "评估语调、语速、停顿等非语言要素的使用。",
    levels: {
      1: "语调单一，语速不当",
      2: "语调基本正确，但缺乏变化",
      3: "语调自然，语速适当",
      4: "语调富有变化，表达有力",
      5: "副语言要素使用完美，增强表达效果",
    },
    tips: "注意疑问句升调和陈述句降调，练习语速变化，模仿母语者的语调节奏。",
  },
};

const DIM_ADVICE: Record<string, string> = {
  "发音标准度": "多听示范音频跟读，重点练习元音饱满度和词尾辅音，可使用录音自评。",
  "语法规范性": "重点复习时态、主谓一致和介词搭配，口头练习时注意自我纠正。",
  "词汇适配性": "积累场景核心词汇和固定搭配，用同义替换避免重复使用基础词汇。",
  "语言功能达成度": "先确保完成所有交际要点再追求复杂表达，练习前先列出关键步骤。",
  "语用策略得体性": "学习使用 'I'd like', 'Could you...' 等委婉表达，强化礼貌标记词。",
  "话语回合适配性": "练习使用 'Well', 'Actually', 'Sure' 等话语标记自然开启回应，注意话轮交替节奏。",
  "副语言匹配度": "注意疑问句升调和陈述句降调，练习语速变化和情感语调，可跟读示范音频。",
};

const TAB_ICONS: Record<TabKey, string> = {
  assessment: "📊",
  phrases: "💬",
  dialogue: "🎙️",
  exercises: "✍️",
  oral: "🎤",
};

const TAB_LABELS: Record<TabKey, string> = {
  assessment: "当前能力评估",
  phrases: "场景词块与句式",
  dialogue: "示范对话",
  exercises: "即时练习",
  oral: "口语练习",
};

/* ============================================================
   Mock 学习材料（LLM 不可用时的兜底）
   ============================================================ */
const DEFAULT_PHRASES: PhraseItem[] = [
  { function: "礼貌请求", sentence: "I'd like a large latte, please." },
  { function: "委婉询问", sentence: "Could I have that with oat milk instead?" },
  { function: "确认信息", sentence: "So that's a medium iced latte — correct?" },
  { function: "回应提议", sentence: "Yes, for here, please. / To go, thanks." },
  { function: "表达感谢", sentence: "Thank you so much! Have a great day!" },
  { function: "请求重复", sentence: "Sorry, could you say that again?" },
];

const DEFAULT_DIALOGUE: DialogueData = {
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
   工具函数
   ============================================================ */
const getInitialProgress = (): LearningProgress => ({
  tabs: {
    assessment: "unvisited",
    phrases: "unvisited",
    dialogue: "unvisited",
    exercises: "unvisited",
    oral: "unvisited",
  },
  exercisesCompleted: 0,
  totalExercises: 3,
  startTime: Date.now(),
  phrasesLearned: [],
});

const loadProgress = (): LearningProgress => {
  try {
    const saved = localStorage.getItem("facilitate_progress");
    return saved ? JSON.parse(saved) : getInitialProgress();
  } catch {
    return getInitialProgress();
  }
};

const saveProgress = (progress: LearningProgress) => {
  localStorage.setItem("facilitate_progress", JSON.stringify(progress));
};

/** 把指定 tab 标记为 completed，并持久化 */
const markTabComplete = (
  setProgress: React.Dispatch<React.SetStateAction<LearningProgress>>,
  key: TabKey
) => {
  setProgress((prev) => {
    const newProgress: LearningProgress = {
      ...prev,
      tabs: { ...prev.tabs, [key]: "completed" },
    };
    saveProgress(newProgress);
    return newProgress;
  });
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    alert("已复制到剪贴板！");
  } catch {
    alert("复制失败，请手动复制");
  }
};

/* ============================================================
   页面组件
   ============================================================ */
export default function FacilitatePage() {
  const router = useRouter();

  // ---- 所有 useState 必须在早期返回之前 ----
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [taskContext, setTaskContext] = useState<{ task_id: number; scene_label: string; roles: string; goal: string }>({
    task_id: 0,
    scene_label: "",
    roles: "",
    goal: "",
  });
  const [hasTask, setHasTask] = useState(false);

  // ---- 学习材料 ----
  const [phrases, setPhrases] = useState<PhraseItem[]>([]);
  const [dialogue, setDialogue] = useState<DialogueData | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);

  // ---- Tab ----
  const [tab, setTab] = useState<TabKey>("assessment");

  // ---- 练习状态 ----
  const [exerciseState, setExerciseState] = useState<
    Record<number, { selected: string | null; revealed: boolean }>
  >({});

  // ---- 能力评估数据 ----
  const [scores, setScores] = useState<DimScores | null>(null);
  const [scoresLoading, setScoresLoading] = useState(true);

  // ---- 学习进度 ----
  const [progress, setProgress] = useState<LearningProgress>(getInitialProgress());
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [devicePassed, setDevicePassed] = useState(false);

  // ---- 初始化 ----
  useEffect(() => {
    setDevicePassed(isDeviceCheckPassed());
  }, []);

  useEffect(() => {
    if (isTaskSelectedInSession()) {
      let hasData = false;
      try {
        const raw = localStorage.getItem("diagnosis");
        if (raw) {
          const data = JSON.parse(raw);
          setGaps(Array.isArray(data) ? data : data.gaps ?? []);
          hasData = true;
        }
      } catch {
        /* ignore */
      }
      try {
        const raw = localStorage.getItem("currentTask");
        if (raw) {
          const t = JSON.parse(raw);
          setTaskContext({
            task_id: t.task_id ?? 0,
            scene_label: t.scene_label ?? "",
            roles: t.roles ?? "",
            goal: t.goal ?? "",
          });
          hasData = true;
        }
      } catch {
        /* ignore */
      }
      setHasTask(hasData);
      setHasHistory(false);
      setInitDone(true);
      return;
    }

    const history = getScenarioHistory();
    setHasHistory(history.length > 0);

    let hasData = false;
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const data = JSON.parse(raw);
        setGaps(Array.isArray(data) ? data : data.gaps ?? []);
        hasData = true;
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem("currentTask");
      if (raw) {
        const t = JSON.parse(raw);
        setTaskContext({
          task_id: t.task_id ?? 0,
          scene_label: t.scene_label ?? "",
          roles: t.roles ?? "",
          goal: t.goal ?? "",
        });
        hasData = true;
      }
    } catch {
      /* ignore */
    }
    setHasTask(hasData);
    setInitDone(true);
  }, []);

  // ---- 加载学习进度 ----
  useEffect(() => {
    if (hasTask && initDone) {
      setProgress(loadProgress());
    }
  }, [hasTask, initDone]);

  // ---- Tab 切换时更新进度 ----
  useEffect(() => {
    if (!hasTask || !initDone) return;

    setProgress((prev) => {
      const newProgress = {
        ...prev,
        tabs: {
          ...prev.tabs,
          [tab]: prev.tabs[tab] === "completed" ? "completed" : "visited",
        },
      };
      saveProgress(newProgress);
      return newProgress;
    });
  }, [tab, hasTask, initDone]);

  // ---- 学习材料（后端动态生成 + Mock 兜底）----
  useEffect(() => {
    if (!initDone || !hasTask) return;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/facilitate/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskContext.task_id,
            gaps: gaps.map((g) => ({
              label: g.label,
              evidence_sentence: g.evidence_sentence,
              explanation: g.explanation,
            })),
            scene_label: taskContext.scene_label,
            roles: taskContext.roles,
            goal: taskContext.goal,
            attempt_number: (() => { try { return localStorage.getItem("diagnosis2") ? 2 : 1; } catch { return 1; } })(),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPhrases(data.phrases ?? []);
          setDialogue(data.dialogue ?? null);
          setExercises(data.exercises ?? []);
        } else {
          throw new Error(`${res.status}`);
        }
      } catch {
        setPhrases(DEFAULT_PHRASES);
        setDialogue(DEFAULT_DIALOGUE);
        setExercises(DEFAULT_EXERCISES);
      } finally {
        setMaterialsLoading(false);
      }
    })();
  }, [initDone, hasTask, gaps, taskContext]);

  // ---- 能力评估 ----
  useEffect(() => {
    if (!initDone || !hasTask) return;
    (async () => {
      try {
        let text = "";
        try {
          // 优先读取完整对话文本
          const convText = localStorage.getItem("conversationText") || localStorage.getItem("conversationText2");
          if (convText && convText.trim().length > 0) {
            text = convText.trim();
          } else {
            // 降级：使用 diagnosis 中的 evidence_sentence 拼接
            const diagRaw = localStorage.getItem("diagnosis");
            if (diagRaw) {
              const diag = JSON.parse(diagRaw);
              const gapList = Array.isArray(diag) ? diag : diag?.gaps ?? [];
              text = gapList.map((g: any) => g?.evidence_sentence ?? "").filter(Boolean).join(" ");
            }
          }
        } catch {
          /* ignore */
        }

        const audioPaths = JSON.parse(localStorage.getItem("attempt1_audio_urls") || "[]");
        const res = await fetch(`${BASE_URL}/api/evaluate-single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_text: text || "no text",
            audio_paths: audioPaths,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const rawScores = data?.dimension_scores ?? data;
          if (rawScores && typeof rawScores === "object" && Object.keys(rawScores).length > 0) {
            const filtered: DimScores = {};
            for (const dim of DIM_ORDER) {
              if (dim in rawScores) filtered[dim] = Number(rawScores[dim]) || 0;
            }
            setScores(Object.keys(filtered).length > 0 ? filtered : getMockScores());
          } else {
            throw new Error("empty scores");
          }
        } else {
          throw new Error(`${res.status}`);
        }
      } catch {
        setScores(getMockScores());
      } finally {
        setScoresLoading(false);
      }
    })();
  }, [initDone, hasTask]);

  // ---- 练习处理 ----
  const selectOption = (exId: number, key: string) => {
    setExerciseState((prev) => ({
      ...prev,
      [exId]: { selected: key, revealed: true },
    }));

    const newState = {
      ...exerciseState,
      [exId]: { selected: key, revealed: true },
    };

    const completed = Object.values(newState).filter((s) => s?.revealed).length;
    setProgress((prev) => {
      const newProgress = {
        ...prev,
        exercisesCompleted: completed,
        totalExercises: exercises.length,
      };
      saveProgress(newProgress);
      return newProgress;
    });
  };

  // ---- 词块学习 ----
  const learnPhrase = (sentence: string) => {
    copyToClipboard(sentence);
    setProgress((prev) => {
      if (!prev.phrasesLearned.includes(sentence)) {
        const newProgress = {
          ...prev,
          phrasesLearned: [...prev.phrasesLearned, sentence],
        };
        saveProgress(newProgress);
        return newProgress;
      }
      return prev;
    });
  };

  // ---- 计算进度 ----
  const weakDims: string[] = (() => {
    if (!scores) return [];
    const entries = Object.entries(scores).filter(([, v]) => typeof v === "number");
    if (entries.length === 0) return [];
    return entries.sort(([, a], [, b]) => a - b).slice(0, 2).map(([k]) => k);
  })();

  const getLearningMinutes = () => {
    const elapsed = Date.now() - progress.startTime;
    return Math.floor(elapsed / 60000);
  };

  const getOverallProgress = () => {
    const tabWeight = 20; // 每个Tab占20%
    const exerciseWeight = 20; // 练习占20%

    let progressPercent = 0;
    Object.values(progress.tabs).forEach((status) => {
      if (status === "visited") progressPercent += tabWeight * 0.5;
      if (status === "completed") progressPercent += tabWeight;
    });

    const exercisePercent = progress.totalExercises > 0
      ? (progress.exercisesCompleted / progress.totalExercises) * exerciseWeight
      : 0;

    return Math.min(progressPercent + exercisePercent, 100);
  };

  // ---- 加载中 ----
  if (!initDone) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // ---- 有历史任务 -> 显示选择器 ----
  if (hasHistory) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <HistoryTaskSelector
          onSelected={(item: ScenarioHistoryItem) => {
            markTaskSelectedInSession();
            localStorage.setItem("currentTask", JSON.stringify(item));
            localStorage.removeItem("facilitate_progress");
            setHasHistory(false);
            setTaskContext({
              task_id: item.task?.task_id ?? 0,
              scene_label: item.sceneLabel ?? "",
              roles: item.roles ?? "",
              goal: item.goal ?? "",
            });
            setHasTask(true);
          }}
        />
      </div>
    );
  }

  // ---- 无历史任务且无任务数据 ----
  if (!hasTask) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <HistoryTaskSelector
          autoRedirectIfEmpty
          reloadOnSelect
          onSelected={(item: ScenarioHistoryItem) => {
            markTaskSelectedInSession();
            localStorage.setItem("currentTask", JSON.stringify(item));
            localStorage.removeItem("facilitate_progress");
            setHasHistory(false);
            setTaskContext({
              task_id: item.task?.task_id ?? 0,
              scene_label: item.sceneLabel ?? "",
              roles: item.roles ?? "",
              goal: item.goal ?? "",
            });
            setHasTask(true);
          }}
        />
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-white to-primary/10">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 设备检测入口提示 */}
        <div className={`mb-4 flex items-center justify-between rounded-lg px-4 py-2 text-sm ${
          devicePassed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
        }`}>
          <span className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${devicePassed ? "bg-emerald-500" : "bg-amber-500"}`} />
            {devicePassed ? "设备就绪：摄像头和麦克风可用" : "建议先进行设备检测，确保后续练习顺畅"}
          </span>
          <button
            onClick={() => router.push("/device-check")}
            className="rounded-md bg-white/60 px-3 py-1 text-xs font-medium hover:bg-white"
          >
            {devicePassed ? "重新检测" : "去检测"}
          </button>
        </div>
        {/* 顶部渐变区域 */}
        <div className="relative mb-8 overflow-hidden rounded-2xl bg-primary p-8 text-primary-foreground">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/20 blur-3xl"></div>
            <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">📚</span>
              <h1 className="text-2xl font-bold sm:text-3xl">促成学习</h1>
            </div>
            <p className="text-primary-foreground/70 mt-2">
              能力评估 + 针对性输入 + 即时练习
              {gaps.length > 0 && (
                <span className="ml-2 text-primary-foreground/50">— 基于 {gaps.length} 项诊断不足</span>
              )}
            </p>

            {/* 学习进度条 */}
            <div className="mt-6">
              <div className="flex justify-between text-sm text-primary-foreground/70 mb-2">
                <span>学习进度</span>
                <span>{Math.round(getOverallProgress())}% · {getLearningMinutes()} 分钟</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-500"
                  style={{ width: `${getOverallProgress()}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        {/* 诊断标签 - 改用 amber，避免红色过多 */}
        {gaps.length > 0 && (
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-2">🎯 重点提升方向：</p>
            <div className="flex flex-wrap gap-2">
              {gaps.map((g, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-700 border border-amber-200 hover:bg-amber-200 transition-colors"
                >
                  <span className="text-amber-500">•</span>
                  {g.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tab 导航 */}
        <div className="mb-6">
          <div className="card flex flex-wrap gap-2 p-2">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  tab === t
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <span>{TAB_ICONS[t]}</span>
                <span>{TAB_LABELS[t]}</span>
                {progress.tabs[t] === "completed" && (
                  <span className="ml-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    ✓
                  </span>
                )}
                {progress.tabs[t] === "visited" && (
                  <span className="ml-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                    ...
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div className="card p-8" key={tab}>
          <div className="transition-opacity duration-200">
          {tab === "assessment" && (
            <AssessmentTab
              scores={scores}
              loading={scoresLoading}
              weakDims={weakDims}
              expandedDim={expandedDim}
              setExpandedDim={setExpandedDim}
              onComplete={() => markTabComplete(setProgress, "assessment")}
            />
          )}
          {tab === "phrases" && (
            materialsLoading ? (
              <InlineLoadingHint show message="正在为你定制场景词块..." height="h-64" />
            ) : (
              <PhrasesTab
                phrases={phrases.length > 0 ? phrases : DEFAULT_PHRASES}
                learnedPhrases={progress.phrasesLearned}
                onLearn={learnPhrase}
                onComplete={() => markTabComplete(setProgress, "phrases")}
              />
            )
          )}
          {tab === "dialogue" && (
            materialsLoading ? (
              <InlineLoadingHint show message="正在生成示范对话..." height="h-64" />
            ) : (
              <DialogueTab
                dialogue={dialogue ?? DEFAULT_DIALOGUE}
                onComplete={() => markTabComplete(setProgress, "dialogue")}
              />
            )
          )}
          {tab === "exercises" && (
            materialsLoading ? (
              <InlineLoadingHint show message="正在为你准备练习题..." height="h-64" />
            ) : (
              <ExercisesTab
                exercises={exercises.length > 0 ? exercises : DEFAULT_EXERCISES}
                state={exerciseState}
                onSelect={selectOption}
                onComplete={() => markTabComplete(setProgress, "exercises")}
              />
            )
          )}
          {tab === "oral" && (
            <OralTab
              sentences={phrases.length > 0 ? phrases.map((p) => p.sentence) : DEFAULT_PHRASES.map((p) => p.sentence)}
              onComplete={() => markTabComplete(setProgress, "oral")}
            />
          )}
          </div>
        </div>

        {/* 底部操作区域 */}
        <div className="mt-8 card p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">准备好继续了吗？</p>
              <p className="text-sm text-muted-foreground mt-1">
                完成学习后，用改进的表达进行第二次产出
              </p>
            </div>
              <button key="continue" className="w-full sm:w-auto card bg-primary hover:bg-primary/80 text-primary-foreground px-8 py-3 text-sm font-semibold transition-all" onClick={() => router.push("/attempt2")}>
              完成学习，进入二次产出 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Tab0：当前能力评估（雷达图）
   ============================================================ */
function AssessmentTab({
  scores,
  loading,
  weakDims,
  expandedDim,
  setExpandedDim,
  onComplete,
}: {
  scores: DimScores | null;
  loading: boolean;
  weakDims: string[];
  expandedDim: string | null;
  setExpandedDim: (dim: string | null) => void;
  onComplete: () => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [showAllDetails, setShowAllDetails] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return;
    const scoreMap = scores ?? getMockScores();
    const dims = DIM_ORDER.filter((d) => d in scoreMap);
    const values = dims.map((d) => scoreMap[d] ?? 0);
    const indicator = dims.map((name) => ({ name, min: 1, max: 5 }));
    if (indicator.length === 0) {
      DIM_ORDER.forEach((d) => indicator.push({ name: d, min: 1, max: 5 }));
      DIM_ORDER.forEach(() => values.push(3));
    }

    const chart = echarts.init(chartRef.current);
    chart.setOption({
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          let result = `${params.name}<br/>`;
          params.value.forEach((val: number, idx: number) => {
            const dim = dims[idx];
            result += `${dim}: ${val} 分<br/>`;
          });
          return result;
        },
      },
      legend: { show: false },
      radar: {
        center: ["50%", "50%"],
        radius: "65%",
        min: 1,
        max: 5,
        indicator,
        axisName: {
          color: "#4B5563",
          fontSize: 13,
          fontWeight: 500,
        },
        splitArea: {
          areaStyle: {
            color: ["#EFF6FF", "#DBEAFE", "#BFDBFE", "#93C5FD", "#60A5FA"],
          },
        },
        splitLine: {
          lineStyle: {
            color: "#93C5FD",
          },
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: values,
              name: "你的表现",
              areaStyle: {
                color: "rgba(59, 130, 246, 0.3)",
              },
              lineStyle: {
                color: "#3B82F6",
                width: 3,
              },
              itemStyle: {
                color: "#3B82F6",
                borderWidth: 2,
                borderColor: "#fff",
              },
            },
          ],
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, [scores]);

  if (loading) {
    return (
      <InlineLoadingHint show message="正在评估你的能力维度..." height="h-64" />
    );
  }

  if (!scores || Object.keys(scores).length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        暂无评估数据，请先完成初次产出
      </div>
    );
  }

  const scoreMap = scores ?? getMockScores();
  const avgScore =
    Object.values(scoreMap).reduce((a, b) => a + b, 0) / Object.values(scoreMap).length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-foreground">能力评估概览</h2>
        <Button size="sm" variant="outline" onClick={onComplete}>
          标记完成 ✓
        </Button>
      </div>

      {/* 综合评分卡片 */}
      <div className="rounded-xl bg-primary/5 p-6 border border-primary/10">
        <div className="flex items-center gap-6">
          <div className="flex-shrink-0">
            <div className="relative w-24 h-24 flex items-center justify-center">
              <svg className="w-24 h-24 transform -rotate-90">
                <circle cx="48" cy="48" r="40" stroke="#E5E7EB" strokeWidth="8" fill="none" />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke="url(#gradient)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(avgScore / 5) * 251.2} 251.2`}
                />
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3B82F6" />
                    <stop offset="100%" stopColor="#8B5CF6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-2xl font-bold text-foreground">{avgScore.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground">平均分</span>
              </div>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              根据你的初次产出，我们从7个维度进行了综合评估。点击下方卡片可以查看每个维度的详细说明和提升建议。
            </p>
          </div>
        </div>
      </div>

      {/* 雷达图 */}
      <div ref={chartRef} style={{ width: "100%", height: 450 }} className="bg-white rounded-xl"></div>

      {/* 重点提升维度 - 改用 amber */}
      {weakDims.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <h3 className="text-base font-bold text-foreground">需要重点提升的维度</h3>
          </div>
          <div className="space-y-3">
            {weakDims.map((dim) => (
              <div
                key={dim}
                className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-amber-500 text-white text-lg">
                      !
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-amber-900">{dim}</span>
                        <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          {(scoreMap[dim] ?? 0).toFixed(1)} / 5.0
                        </span>
                      </div>
                      <p className="text-xs text-amber-700 mt-1">{DIM_ADVICE[dim]}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedDim(expandedDim === dim ? null : dim)}
                    className="text-xs text-amber-700 hover:text-amber-900 font-medium"
                  >
                    {expandedDim === dim ? "收起详情" : "查看详情"}
                  </button>
                </div>
                {expandedDim === dim && (
                  <div className="mt-4 pt-4 border-t border-amber-200 space-y-4">
                    <DimensionDetail dim={dim} score={scoreMap[dim] ?? 0} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 所有维度详情 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h3 className="text-base font-bold text-foreground">所有能力维度</h3>
          </div>
          <button
            onClick={() => setShowAllDetails(!showAllDetails)}
            className="text-sm text-primary hover:text-primary/80 font-medium"
          >
            {showAllDetails ? "收起全部" : "展开全部"}
          </button>
        </div>
        <div className="space-y-3">
          {DIM_ORDER.filter((d) => d in scoreMap).map((dim) => (
            <div
              key={dim}
              className="card p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">{dim}</span>
                    <div className="flex-1 ml-4">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-500 rounded-full ${
                            (scoreMap[dim] ?? 0) >= 4
                              ? "bg-green-500"
                              : (scoreMap[dim] ?? 0) >= 3
                              ? "bg-amber-500"
                              : "bg-amber-600"
                          }`}
                          style={{ width: `${((scoreMap[dim] ?? 0) / 5) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {(scoreMap[dim] ?? 0).toFixed(1)} / 5
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setExpandedDim(expandedDim === dim ? null : dim)}
                  className="text-xs text-muted-foreground hover:text-foreground font-medium ml-4"
                >
                  {expandedDim === dim ? "收起" : "详情"}
                </button>
              </div>
              {(expandedDim === dim || showAllDetails) && (
                <div className="mt-4 pt-4 border-t border-border">
                  <DimensionDetail dim={dim} score={scoreMap[dim] ?? 0} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   维度详情组件
   ============================================================ */
function DimensionDetail({ dim, score }: { dim: string; score: number }) {
  const info = DIM_DESCRIPTIONS[dim];
  if (!info) return null;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">维度说明</h4>
        <p className="text-sm text-muted-foreground">{info.description}</p>
      </div>
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">评分标准</h4>
        <div className="space-y-2">
          {Object.entries(info.levels)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([level, desc]) => (
              <div
                key={level}
                className={`text-xs p-2 rounded-lg ${
                  Math.round(score) === Number(level)
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <span className="font-medium">{level} 分：</span>
                {desc}
              </div>
            ))}
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">提升建议</h4>
        <p className="text-sm text-muted-foreground bg-yellow-50 p-3 rounded-lg border border-yellow-100">
          💡 {info.tips}
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   Tab1：场景词块与句式
   ============================================================ */
function PhrasesTab({
  phrases,
  learnedPhrases,
  onLearn,
  onComplete,
}: {
  phrases: PhraseItem[];
  learnedPhrases: string[];
  onLearn: (sentence: string) => void;
  onComplete: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-foreground">场景词块与句式</h2>
        <Button size="sm" variant="outline" onClick={onComplete}>
          标记完成 ✓
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        点击任意卡片可以复制英文句子，方便你进行练习。
      </p>

      <div className="grid gap-4">
        {phrases.map((p, i) => {
          const isLearned = learnedPhrases.includes(p.sentence);
          return (
            <div
              key={i}
              onClick={() => onLearn(p.sentence)}
              className={`group cursor-pointer rounded-xl border p-5 transition-all hover:shadow-md ${
                isLearned
                  ? "border-green-200 bg-green-50"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        isLearned
                          ? "bg-green-200 text-green-800"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {p.function}
                    </span>
                    {isLearned && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <span>✓</span> 已学习
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-base font-medium ${
                      isLearned ? "text-green-900" : "text-foreground"
                    }`}
                  >
                    {p.sentence}
                  </p>
                </div>
                <div className="ml-4 flex-shrink-0">
                  <div
                    className={`size-10 rounded-full flex items-center justify-center transition-all ${
                      isLearned
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                    }`}
                  >
                    {isLearned ? "✓" : "📋"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {learnedPhrases.length > 0 && (
        <div className="mt-6 rounded-xl bg-primary/5 p-4 border border-primary/10">
          <p className="text-sm text-primary flex items-center gap-2">
            <span>📝</span>
            已学习 {learnedPhrases.length} / {phrases.length} 个词块
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Tab2：示范对话
   ============================================================ */
function DialogueTab({
  dialogue,
  onComplete,
}: {
  dialogue: DialogueData;
  onComplete: () => void;
}) {
  const [playingLine, setPlayingLine] = useState<number | null>(null);

  const playLine = (text: string, idx: number) => {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onstart = () => setPlayingLine(idx);
      utterance.onend = () => setPlayingLine(null);
      speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-foreground">示范对话</h2>
        <Button size="sm" variant="outline" onClick={onComplete}>
          标记完成 ✓
        </Button>
      </div>

      <div className="rounded-xl bg-primary/5 p-6 border border-primary/10">
        <h3 className="text-sm font-medium text-foreground mb-6">{dialogue.title}</h3>
        <div className="space-y-4">
          {dialogue.lines.map((line, i) => {
            const isLeft = i % 2 === 0;
            return (
              <div
                key={i}
                className={`flex ${isLeft ? "justify-start" : "justify-end"}`}
              >
                <div className={`max-w-[80%] space-y-1 ${isLeft ? "" : "text-right"}`}>
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                    {isLeft ? (
                      <span className="text-lg">👨‍💼</span>
                    ) : (
                      <span className="text-lg">👤</span>
                    )}
                    {line.speaker}
                  </p>
                  <div
                    className={`group rounded-2xl px-5 py-3 text-sm leading-relaxed ${
                      isLeft
                        ? "bg-card text-foreground rounded-bl-md shadow-sm border border-border"
                        : "bg-primary text-primary-foreground rounded-br-md shadow-md"
                    }`}
                  >
                    <p>{line.text}</p>
                  </div>
                  <button
                    onClick={() => playLine(line.text, i)}
                    className={`text-xs mt-1 flex items-center gap-1 ${
                      isLeft ? "text-muted-foreground" : "text-primary-foreground/50"
                    } hover:opacity-70 transition-opacity`}
                  >
                    {playingLine === i ? (
                      <>
                        <span className="animate-pulse">🔊</span> 播放中...
                      </>
                    ) : (
                      <>
                        <span>🔊</span> 播放
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-yellow-50 p-4 border border-yellow-100">
        <p className="text-sm text-yellow-800 flex items-start gap-2">
          <span>💡</span>
          <span>
            点击播放按钮可以听每句话的发音，建议你也跟着模仿朗读，注意语调和停顿。
          </span>
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   Tab3：即时练习
   ============================================================ */
function ExercisesTab({
  exercises,
  state,
  onSelect,
  onComplete,
}: {
  exercises: Exercise[];
  state: Record<number, { selected: string | null; revealed: boolean }>;
  onSelect: (exId: number, key: string) => void;
  onComplete: () => void;
}) {
  const completedCount = Object.values(state).filter((s) => s?.revealed).length;
  const correctCount = Object.entries(state).filter(([exId, s]) => {
    if (!s?.revealed) return false;
    const exercise = exercises.find((e) => e.id === Number(exId));
    return exercise && s.selected === exercise.answer;
  }).length;

  const allCompleted = completedCount === exercises.length && exercises.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-foreground">即时练习</h2>
        {allCompleted && (
          <Button size="sm" variant="outline" onClick={onComplete}>
            标记完成 ✓
          </Button>
        )}
      </div>

      {/* 进度卡片 */}
      {completedCount > 0 && (
        <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 p-4 border border-green-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-900">
                练习进度：{completedCount} / {exercises.length}
              </p>
              <p className="text-sm text-green-700 mt-1">
                正确率：{completedCount > 0 ? Math.round((correctCount / completedCount) * 100) : 0}%
              </p>
            </div>
            <div className="text-3xl">
              {allCompleted && correctCount === completedCount ? "🎉" : "💪"}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {exercises.map((ex, i) => {
          const exState = state[ex.id];
          const revealed = exState?.revealed ?? false;
          const selected = exState?.selected ?? null;
          const isCorrect = revealed && selected === ex.answer;

          return (
            <div
              key={ex.id}
              className={`rounded-xl border p-6 transition-all ${
                revealed
                  ? isCorrect
                    ? "border-green-200 bg-green-50/50"
                    : "border-amber-300 bg-amber-50/50"
                  : "border-border bg-card hover:shadow-md"
              }`}
            >
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-bold text-primary-foreground bg-primary px-3 py-1 rounded-full">
                    第 {i + 1} 题
                  </span>
                  {ex.gap_target && (
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                      🎯 针对你的 {ex.gap_target} 问题
                    </span>
                  )}
                  {revealed && (
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full ${
                        isCorrect
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {isCorrect ? "✓ 正确" : "✗ 错误"}
                    </span>
                  )}
                </div>
                <p className="text-base text-foreground">{ex.context}</p>
              </div>

              <div className="space-y-2">
                {ex.options.map((opt) => {
                  let borderClass = "border-border hover:border-primary/30";
                  let bgClass = "bg-card hover:bg-primary/5";
                  let textClass = "text-foreground";

                  if (revealed) {
                    if (opt.key === ex.answer) {
                      borderClass = "border-green-500";
                      bgClass = "bg-green-50";
                      textClass = "text-green-900";
                    } else if (opt.key === selected) {
                      borderClass = "border-amber-500";
                      bgClass = "bg-amber-50";
                      textClass = "text-amber-900";
                    }
                  } else if (opt.key === selected) {
                    borderClass = "border-primary";
                    bgClass = "bg-primary/5";
                  }

                  return (
                    <button
                      key={opt.key}
                      disabled={revealed}
                      onClick={() => onSelect(ex.id, opt.key)}
                      className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left text-sm transition-all ${borderClass} ${bgClass} ${
                        revealed ? "cursor-default" : "cursor-pointer hover:shadow-sm"
                      }`}
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          revealed
                            ? opt.key === ex.answer
                              ? "bg-green-500 text-white"
                              : opt.key === selected
                              ? "bg-amber-500 text-white"
                              : "bg-muted text-muted-foreground"
                            : opt.key === selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {revealed && opt.key === ex.answer
                          ? "✓"
                          : revealed && opt.key === selected
                          ? "✗"
                          : opt.key}
                      </span>
                      <span className={textClass}>{opt.text}</span>
                    </button>
                  );
                })}
              </div>

              {revealed && (
                <div
                  className={`mt-5 rounded-xl border p-4 ${
                    isCorrect
                      ? "border-green-200 bg-green-50"
                      : "border-amber-200 bg-amber-50/50"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold mb-2 ${
                      isCorrect ? "text-green-700" : "text-amber-800"
                    }`}
                  >
                    {isCorrect ? "太棒了！" : "正确答案是 " + ex.answer}
                  </p>
                  <p className="text-sm text-muted-foreground">{ex.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allCompleted && (
        <div className="rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="text-5xl">🎉</div>
            <div>
              <h3 className="text-lg font-bold">恭喜完成所有练习！</h3>
              <p className="text-green-100 mt-1">
                你答对了 {correctCount} / {exercises.length} 题，做得很好！
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Tab4：口语练习（跟读）
   ============================================================ */
function OralTab({
  sentences,
  onComplete,
}: {
  sentences: string[];
  onComplete: () => void;
}) {
  const [practiced, setPracticed] = useState<Set<number>>(new Set());
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 获取音频流
  const ensureStream = async (): Promise<MediaStream | null> => {
    if (audioStreamRef.current) return audioStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      return stream;
    } catch {
      alert("无法访问麦克风，请检查权限设置");
      return null;
    }
  };

  // TTS 播放
  const playTTS = (text: string) => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    }
  };

  // 开始录音
  const startRecording = async (idx: number) => {
    if (recordingIdx !== null) return;
    const stream = await ensureStream();
    if (!stream) return;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err: unknown) {
      alert("无法启动录音: " + ((err as Error)?.message ?? ""));
      return;
    }

    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      setRecordingIdx(null);
      alert("录音出错，请重试");
    };
    recorder.onstop = () => {
      // 录音完成，标记为已练习
      setPracticed((prev) => {
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
    };

    recorder.start();
    setRecordingIdx(idx);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
  };

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingIdx(null);
    setElapsed(0);
  };

  const practicedCount = practiced.size;
  const allDone = practicedCount >= Math.min(2, sentences.length);

  useEffect(() => {
    if (allDone) onComplete();
  }, [allDone, onComplete]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-foreground">口语练习</h2>
        {allDone && (
          <span className="text-xs font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-200">
            ✓ 已完成
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        跟读以下示范语句，点击「播放」听 TTS 发音，然后点击「录音」进行跟读练习。
        完成至少 {Math.min(2, sentences.length)} 句跟读后即可标记完成。
      </p>

      {/* 进度 */}
      {practicedCount > 0 && (
        <div className="rounded-xl bg-blue-50 p-4 border border-blue-100">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-900">
              已跟读 {practicedCount} / {sentences.length} 句
            </p>
            <div className="h-2 flex-1 mx-4 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${(practicedCount / sentences.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sentences.slice(0, 5).map((sentence, i) => {
          const isPracticed = practiced.has(i);
          const isRecording = recordingIdx === i;

          return (
            <div
              key={i}
              className={`rounded-xl border p-5 transition-all ${
                isPracticed
                  ? "border-green-200 bg-green-50/50"
                  : isRecording
                    ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200"
                    : "border-border bg-card hover:shadow-md"
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isPracticed
                      ? "bg-green-500 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isPracticed ? "✓" : i + 1}
                </span>
                <span className={`text-base font-medium ${isPracticed ? "text-green-900" : "text-foreground"}`}>
                  {sentence}
                </span>
              </div>

              <div className="flex items-center gap-3 ml-11">
                <button
                  onClick={() => playTTS(sentence)}
                  disabled={isRecording}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-all disabled:opacity-50"
                >
                  <span>🔊</span>
                  播放TTS
                </button>

                {isRecording ? (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-all animate-pulse"
                  >
                    <span>⏹</span>
                    停止录音 ({elapsed}s)
                  </button>
                ) : (
                  <button
                    onClick={() => startRecording(i)}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                      isPracticed
                        ? "border border-green-300 bg-green-100 text-green-700"
                        : "bg-primary text-primary-foreground hover:bg-primary/80"
                    }`}
                  >
                    <span>{isPracticed ? "🔄" : "🎙️"}</span>
                    {isPracticed ? "重新录音" : "开始录音"}
                  </button>
                )}

                {isPracticed && (
                  <span className="text-sm text-green-600 font-medium">✓ 已完成</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && (
        <div className="rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="text-5xl">🎉</div>
            <div>
              <h3 className="text-lg font-bold">口语练习完成！</h3>
              <p className="text-green-100 mt-1">
                你已完成 {practicedCount} 句跟读练习，发音准确度来源于反复模仿。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   辅助函数
   ============================================================ */
function getMockScores(): DimScores {
  return {
    "发音标准度": 2.5,
    "语法规范性": 2.0,
    "词汇适配性": 1.5,
    "语言功能达成度": 3.0,
    "语用策略得体性": 1.5,
    "话语回合适配性": 2.0,
    "副语言匹配度": 3.0,
  };
}
