"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import * as echarts from "echarts";

/* ============================================================
   常量
   ============================================================ */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** 国创标准 7 维度（固定顺序，cnName 匹配后端返回的中文维度名） */
const RADAR_DIMENSIONS = [
  { key: "pronunciation",   label: "发音标准度",       cnName: "发音标准度" },
  { key: "grammar",         label: "语法规范性",       cnName: "语法规范性" },
  { key: "vocabulary",      label: "词汇适配性",       cnName: "词汇适配性" },
  { key: "task_completion", label: "语言功能达成度",    cnName: "语言功能达成度" },
  { key: "pragmatics",      label: "语用策略得体性",    cnName: "语用策略得体性" },
  { key: "turn_taking",     label: "话语回合适配性",    cnName: "话语回合适配性" },
  { key: "paralinguistic",  label: "副语言匹配度",     cnName: "副语言匹配度" },
] as const;

const RADAR_MAX = 10;

/* ============================================================
   类型：匹配后端 /api/evaluate-single 实际响应
   ============================================================ */
interface EvaluateSingleResponse {
  dimension_scores: Record<string, number>;
  comments: Record<string, string>;
}

/* ============================================================
   辅助函数：从可用来源拼凑 attempt1 文本
   ============================================================ */
function collectAttempt1Text(): string {
  // 1. 优先从 attempt1_full_text（提交时存储的完整 ASR 转写）读取
  try {
    const raw = localStorage.getItem("attempt1_full_text");
    if (raw && raw.trim()) return raw;
  } catch { /* ignore */ }

  // 2. 回退：从 attempt1_user_texts（ASR 转写数组）拼接
  try {
    const raw = localStorage.getItem("attempt1_user_texts");
    if (raw) {
      const texts = JSON.parse(raw);
      if (Array.isArray(texts)) {
        const joined = texts.filter(Boolean).join("\n");
        if (joined.trim()) return joined;
      }
    }
  } catch { /* ignore */ }

  // 3. 回退：从 diagnosis 的 evidence_sentence 提取
  try {
    const raw = localStorage.getItem("diagnosis");
    if (raw) {
      const data = JSON.parse(raw);
      const gaps = Array.isArray(data) ? data : (data.gaps ?? []);
      const parts = gaps.map((g: { evidence_sentence?: string }) => g.evidence_sentence || "").filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
  } catch { /* ignore */ }

  return "";
}

/* ============================================================
   雷达图组件
   ============================================================ */
function EChartsRadar({ data }: { data: EvaluateSingleResponse | null }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const buildOption = useCallback((): echarts.EChartsOption => {
    // 按 RADAR_DIMENSIONS 固定顺序从 dimension_scores 中取值
    const scores = data?.dimension_scores ?? {};

    const values = RADAR_DIMENSIONS.map((dim) => scores[dim.cnName] ?? 0);
    const indicator = RADAR_DIMENSIONS.map((dim) => ({
      name: dim.label,
      max: RADAR_MAX,
    }));

    return {
      radar: {
        indicator,
        center: ["50%", "52%"],
        radius: "62%",
        axisName: {
          color: "#94a3b8",
          fontSize: 12,
          borderRadius: 3,
          padding: [2, 4],
        },
        splitArea: {
          areaStyle: {
            color: ["rgba(99, 102, 241, 0.04)", "rgba(99, 102, 241, 0.08)"],
          },
        },
        splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.2)" } },
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.25)" } },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { color: "#6366f1", width: 2 },
          areaStyle: { color: "rgba(99, 102, 241, 0.25)" },
          itemStyle: { color: "#6366f1" },
          data: [{ value: values, name: "当前能力" }],
        },
      ],
    };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;

    // 销毁旧实例（处理 React StrictMode 双挂载）
    const existing = echarts.getInstanceByDom(chartRef.current);
    if (existing) existing.dispose();

    const instance = echarts.init(chartRef.current, undefined, {
      renderer: "canvas",
    });
    instanceRef.current = instance;
    instance.setOption(buildOption());

    const handleResize = () => instance.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      instance.dispose();
      instanceRef.current = null;
    };
  }, [buildOption]);

  return (
    <div
      ref={chartRef}
      className="w-full"
      style={{ height: 420, minHeight: 300 }}
    />
  );
}

/* ============================================================
   评估详情卡片（雷达图下方各维度分数+评语）
   ============================================================ */
function DimensionScoreList({ data }: { data: EvaluateSingleResponse }) {
  const scores = data?.dimension_scores ?? {};
  const comments = data?.comments ?? {};

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-card-foreground">维度详情</h3>

      {RADAR_DIMENSIONS.map((dim) => {
        const score = scores[dim.cnName] ?? 0;
        const comment = comments[dim.cnName] ?? "";

        return (
          <div
            key={dim.key}
            className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-card-foreground">
                {dim.label}
              </span>
              <span className="inline-flex items-center justify-center size-8 rounded-full bg-primary/10 text-sm font-bold text-primary tabular-nums">
                {score}
              </span>
            </div>
            {/* 分数条 */}
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${(score / RADAR_MAX) * 100}%` }}
              />
            </div>
            {/* 评语 */}
            {comment && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {comment}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   页面组件
   ============================================================ */
export default function FacilitatePage() {
  const router = useRouter();
  const { attempt1Gaps, inputPack, exercises, setInputPack, setExercises } =
    usePOA();

  // ---- Tab ----
  const [tab, setTab] = useState<"material" | "evaluate">("material");

  // ---- 学习材料状态 ----
  const [pack, setPack] = useState<InputPackResult | null>(inputPack);
  const [exs, setExs] = useState<ExerciseItem[]>(exercises.length ? exercises : []);
  const [packLoading, setPackLoading] = useState(false);
  const [exLoading, setExLoading] = useState(false);
  const [error, setError] = useState("");

  // 从 POA 上下文或 localStorage diagnosis 获取 gaps
  const activeGaps: GapItem[] = (() => {
    if (attempt1Gaps.length > 0) return attempt1Gaps;
    try {
      const raw = localStorage.getItem("diagnosis");
      if (raw) {
        const data = JSON.parse(raw);
        const gaps = Array.isArray(data) ? data : (data.gaps ?? []);
        if (gaps.length > 0) return gaps;
      }
    } catch { /* ignore */ }
    return [];
  })();

  // ---- 能力评估状态 ----
  const [evalData, setEvalData] = useState<EvaluateSingleResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState("");

  // ---- 切换到评估 tab 时自动请求 ----
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (tab !== "evaluate" || fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchEval = async () => {
      setEvalLoading(true);
      setEvalError("");
      try {
        const text = collectAttempt1Text();

        // 无初次产出记录 → 提前提示
        if (!text.trim()) {
          setEvalError("未找到初次产出记录，无法评估。请先完成初次产出并提交诊断。");
          setEvalLoading(false);
          return;
        }

        // 读取任务上下文，辅助评估
        let taskContext: Record<string, string> | undefined;
        try {
          const raw = localStorage.getItem("currentTask");
          if (raw) {
            const t = JSON.parse(raw);
            taskContext = {
              scene_label: t.scene_label || "",
              roles: t.roles || "",
              goal: t.goal || "",
            };
          }
        } catch { /* ignore */ }

        const res = await fetch(`${BASE_URL}/api/evaluate-single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attempt_text: text, task_context: taskContext }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();

        // 处理后端 no_voice 错误
        if (json.error === "no_voice") {
          setEvalError(json.message || "未找到有效的初次产出语音内容");
          setEvalLoading(false);
          return;
        }

        setEvalData(json as EvaluateSingleResponse);
      } catch {
        setEvalError("评估数据暂不可用");
      } finally {
        setEvalLoading(false);
      }
    };

    fetchEval();
  }, [tab]);

  // ---- 学习材料操作 ----
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

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="space-y-6">
      {/* ---- 页面标题 ---- */}
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
          促成学习
        </h1>
        <p className="mt-2 text-muted-foreground">
          针对初次产出中的不足，AI 生成学习材料与练习题，帮你搭建语言支架。
        </p>
      </div>

      {/* ---- Tab 切换 ---- */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1 w-fit">
        {([
          ["material", "学习材料"],
          ["evaluate", "当前能力评估"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
              tab === value
                ? "bg-background text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-card-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ================================
           Tab 1: 学习材料
           ================================ */}
      {tab === "material" && (
        <>
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

          {pack && <InputPackCard pack={pack} />}
          {exs.length > 0 && <ExerciseList exercises={exs} />}
        </>
      )}

      {/* ================================
           Tab 2: 当前能力评估
           ================================ */}
      {tab === "evaluate" && (
        <div className="space-y-6">
          {/* 加载中 */}
          {evalLoading && (
            <div className="rounded-lg border border-border bg-card p-8 shadow-sm text-center">
              <p className="text-muted-foreground animate-pulse">
                正在评估你的当前能力...
              </p>
            </div>
          )}

          {/* 错误 */}
          {evalError && (
            <div className="rounded-lg border border-border bg-card p-8 shadow-sm text-center">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-muted mb-3">
                <svg className="size-6 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="text-muted-foreground font-medium">{evalError}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                请确保已完成初次产出并提交诊断
              </p>
            </div>
          )}

          {/* 雷达图 */}
          {evalData && (
            <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-6">
              {/* 空语音提示：所有维度为 0 */}
              {Object.values(evalData.dimension_scores ?? {}).every((s) => s === 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-center">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    未检测到语音内容，无法评估
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    所有维度评分为 0，请确保初次产出包含有效语音内容。
                  </p>
                </div>
              )}
              <h2 className="text-xl font-semibold text-card-foreground">
                七维能力雷达图
              </h2>
              <EChartsRadar data={evalData} />
              <DimensionScoreList data={evalData} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 学习材料包卡片 ----
function InputPackCard({ pack }: { pack: InputPackResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-6">
      <h2 className="text-xl font-semibold text-card-foreground">学习材料包</h2>

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

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          示范对话
        </h3>
        <pre className="whitespace-pre-line rounded-md border border-border bg-muted/30 p-3 text-sm text-card-foreground">
          {pack.demo_dialogue}
        </pre>
      </div>

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
