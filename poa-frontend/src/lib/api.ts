/**
 * API 客户端 —— 封装对后端所有接口的 fetch 调用。
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${path} 返回 ${res.status}: ${detail}`);
  }
  return res.json();
}

export interface ScenarioResult {
  scene_label: string;
  roles: string;
  goal: string;
  context_constraints: string;
  evaluation_criteria: string;
  variant_plot: string;
}

export async function analyzeScenario(image_path: string): Promise<ScenarioResult> {
  return request<ScenarioResult>("/api/scenario/analyze", { image_path });
}

export async function uploadImage(file: File): Promise<{ image_url: string }> {
  const url = `${BACKEND_URL}/api/upload/image`;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let errorDetail = "";
    try {
      const json = await res.json();
      errorDetail = json.detail || JSON.stringify(json);
    } catch {
      errorDetail = await res.text().catch(() => "");
    }
    throw new Error(`Upload failed: ${res.status}${errorDetail ? ` - ${errorDetail}` : ""}`);
  }
  return res.json();
}

export interface GapItem {
  label: string;
  evidence_sentence: string | null;
  explanation: string | null;
}

export interface DiagnoseResult {
  gaps: GapItem[];
}

export async function diagnoseAttempt(attempt_text: string): Promise<DiagnoseResult> {
  return request<DiagnoseResult>("/api/attempt1/submit", { attempt_text });
}

export interface ChunkItem {
  chunk: string;
  meaning: string;
  usage: string;
}

export interface FunctionSentence {
  function: string;
  sentence: string;
}

export interface InputPackResult {
  scene_chunks: ChunkItem[];
  functional_sentences: FunctionSentence[];
  demo_dialogue: string;
  strategy_tip: string;
}

export async function generateInputPack(gaps: GapItem[]): Promise<InputPackResult> {
  return request<InputPackResult>("/api/generate-input-pack", { gaps });
}

export interface ExerciseItem {
  id: number;
  type: "multiple_choice" | "fill_in_blank";
  gap_target: string;
  question: string;
  options: { key: string; text: string }[];
  answer: string;
  feedback: string;
}

export interface ExercisesResult {
  exercises: ExerciseItem[];
}

export async function generateExercises(gaps: GapItem[]): Promise<ExercisesResult> {
  return request<ExercisesResult>("/api/generate-exercises", { gaps });
}

export interface DimensionScore {
  attempt1: number;
  attempt2: number;
}

export interface EvaluateResult {
  dimension_scores: Record<string, DimensionScore>;
  problem_improved: string;
  full_report: string;
}

export async function evaluateAttempts(
  attempt_text: string,
  attempt2_text: string
): Promise<EvaluateResult> {
  return request<EvaluateResult>("/api/evaluate", { attempt1_text, attempt2_text });
}
