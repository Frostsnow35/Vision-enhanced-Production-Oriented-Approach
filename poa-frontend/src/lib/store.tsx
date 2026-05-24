/**
 * 共享状态管理 —— 使用 React Context 在页面间传递 POA 学习闭环各环节的数据。
 * 所有状态仅保存在内存中，刷新后清空。
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
