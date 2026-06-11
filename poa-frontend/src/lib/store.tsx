/**
 * 共享状态管理 —— 使用 React Context 在页面间传递 POA 学习闭环各环节的数据。
 * 所有状态仅保存在内存中，刷新后清空。
 *
 * 场景历史通过 localStorage("poa_scenarios") 持久化。
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

import type {
  ScenarioResult,
  GapItem,
  InputPackResult,
  ExerciseItem,
  EvaluateResult,
} from "./api";

// ---- 场景历史类型 ----
export interface ScenarioHistoryItem {
  id: string;
  scenarioId: number | null;
  createdAt: string;
  sceneLabel: string;
  roles: string;
  goal: string;
  imageUrl: string;
  task: ScenarioResult;
}

// ---- 学习旅程类型（evaluate 完成时写入，用于首页 dashboard） ----
export interface JourneyDimensionScore {
  attempt1: number;
  attempt2: number;
  change: number;
}

export interface JourneyEntry {
  id: string;
  sceneLabel: string;
  taskTitle: string;
  imageUrl?: string;
  completedAt: number;        // 时间戳
  avgScore: number;           // 二次产出七维均分
  dimensionScores: Record<string, JourneyDimensionScore>;
}

// ---- 场景历史工具函数 ----
const SCENARIOS_KEY = "poa_scenarios";
const CURRENT_ID_KEY = "currentScenarioId";
const SESSION_TASK_KEY = "poa_task_selected";

export function getScenarioHistory(): ScenarioHistoryItem[] {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addScenarioToHistory(item: ScenarioHistoryItem): void {
  const list = getScenarioHistory().filter((s) => s.id !== item.id);
  list.unshift(item);
  if (list.length > 20) list.length = 20;
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(list));
}

export function removeScenarioFromHistory(id: string): void {
  const list = getScenarioHistory().filter((s) => s.id !== id);
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(list));
}

export function selectScenario(id: string): ScenarioHistoryItem | null {
  const list = getScenarioHistory();
  const item = list.find((s) => s.id === id) ?? null;
  if (item) {
    localStorage.setItem(CURRENT_ID_KEY, id);
    localStorage.setItem("currentTask", JSON.stringify(item.task));
    markTaskSelectedInSession();
  }
  return item;
}

// ---- 会话标记（刷新/关闭后丢失）----
export function markTaskSelectedInSession(): void {
  try {
    sessionStorage.setItem(SESSION_TASK_KEY, "true");
  } catch { /* ignore */ }
}

export function isTaskSelectedInSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_TASK_KEY) === "true";
  } catch {
    return false;
  }
}

export function clearSessionTaskMark(): void {
  try {
    sessionStorage.removeItem(SESSION_TASK_KEY);
  } catch { /* ignore */ }
}

// ---- 学习旅程工具函数（持久化到 localStorage） ----
const JOURNEY_KEY = "poa_learning_journey";

export function getLearningJourney(): JourneyEntry[] {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addJourneyEntry(entry: Omit<JourneyEntry, "id">): JourneyEntry {
  const list = getLearningJourney();
  const id = generateId();
  const newEntry: JourneyEntry = { ...entry, id };
  // 按场景去重（同一场景更新最新分数）
  const filtered = list.filter((e) => e.sceneLabel !== newEntry.sceneLabel);
  filtered.unshift(newEntry);
  const trimmed = filtered.slice(0, 20);  // 最多保留 20 条
  localStorage.setItem(JOURNEY_KEY, JSON.stringify(trimmed));
  return newEntry;
}

export function clearLearningJourney(): void {
  localStorage.removeItem(JOURNEY_KEY);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createScenarioFromResult(
  result: ScenarioResult & { scenario_id?: number },
  imageUrl: string,
): ScenarioHistoryItem {
  return {
    id: generateId(),
    scenarioId: result.scenario_id ?? null,
    createdAt: new Date().toISOString(),
    sceneLabel: result.scene_label,
    roles: result.roles,
    goal: result.goal,
    imageUrl,
    task: result,
  };
}

// ---- 状态类型 ----
interface POAState {
  scenarioResult: ScenarioResult | null;
  attempt1Text: string;
  attempt1Gaps: GapItem[];
  attempt2Text: string;
  attempt2Gaps: GapItem[];
  inputPack: InputPackResult | null;
  exercises: ExerciseItem[];
  evaluateResult: EvaluateResult | null;
}

interface POAActions {
  setScenarioResult: (r: ScenarioResult) => void;
  setAttempt1: (text: string, gaps: GapItem[]) => void;
  setInputPack: (pack: InputPackResult) => void;
  setExercises: (exs: ExerciseItem[]) => void;
  setAttempt2: (text: string, gaps: GapItem[]) => void;
  setEvaluateResult: (r: EvaluateResult) => void;
  reset: () => void;
}

type POAContextType = POAState & POAActions;

const initialState: POAState = {
  scenarioResult: null,
  attempt1Text: "",
  attempt1Gaps: [],
  attempt2Text: "",
  attempt2Gaps: [],
  inputPack: null,
  exercises: [],
  evaluateResult: null,
};

const POAContext = createContext<POAContextType | null>(null);

// ---- Provider ----
export function POAProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<POAState>(initialState);

  const setScenarioResult = useCallback((r: ScenarioResult) => {
    setState((s) => ({ ...s, scenarioResult: r }));
  }, []);

  const setAttempt1 = useCallback((text: string, gaps: GapItem[]) => {
    setState((s) => ({ ...s, attempt1Text: text, attempt1Gaps: gaps }));
  }, []);

  const setInputPack = useCallback((pack: InputPackResult) => {
    setState((s) => ({ ...s, inputPack: pack }));
  }, []);

  const setExercises = useCallback((exs: ExerciseItem[]) => {
    setState((s) => ({ ...s, exercises: exs }));
  }, []);

  const setAttempt2 = useCallback((text: string, gaps: GapItem[]) => {
    setState((s) => ({ ...s, attempt2Text: text, attempt2Gaps: gaps }));
  }, []);

  const setEvaluateResult = useCallback((r: EvaluateResult) => {
    setState((s) => ({ ...s, evaluateResult: r }));
  }, []);

  const reset = useCallback(() => setState(initialState), []);

  return (
    <POAContext.Provider
      value={{
        ...state,
        setScenarioResult,
        setAttempt1,
        setInputPack,
        setExercises,
        setAttempt2,
        setEvaluateResult,
        reset,
      }}
    >
      {children}
    </POAContext.Provider>
  );
}

// ---- Hook ----
export function usePOA(): POAContextType {
  const ctx = useContext(POAContext);
  if (!ctx) throw new Error("usePOA must be used within POAProvider");
  return ctx;
}
