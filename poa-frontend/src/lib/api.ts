/**
 * API 客户端 —— 封装对后端所有接口的 fetch 调用。
 * 生产环境自动指向 Railway 后端，本地开发可通过环境变量 NEXT_PUBLIC_API_BASE 覆盖。
 */
const PRODUCTION_BACKEND = "https://poa-backend-production-c371.up.railway.app";
const LOCAL_BACKEND = "http://localhost:8000";

export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "production" ? PRODUCTION_BACKEND : LOCAL_BACKEND);

/**
 * 通用 POST 请求封装（JSON 请求体 → JSON 响应）
 */
async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`API error ${res.status}: ${errText}`);
  }
  return res.json();
}

/**
 * 构建图片 URL
 * 后端静态文件：/uploads/ → uploads/ 目录
 *            /samples/ → sample_images/ 目录
 */
export function buildImageUrl(imagePath: string): string {
  if (!imagePath) return "";
  if (imagePath.startsWith("http")) return imagePath;
  
  // 用户上传的图片：/uploads/images/xxx.jpg → 直接拼接
  if (imagePath.startsWith("/")) {
    return `${BASE_URL}${imagePath}`;
  }
  
  // 样例图片路径转换：sample_images/xxx.jpg → /samples/xxx.jpg
  if (imagePath.startsWith("sample_images/")) {
    return `${BASE_URL}/samples/${imagePath.replace("sample_images/", "")}`;
  }
  
  // 其他情况直接拼接
  return `${BASE_URL}/${imagePath}`;
}

export interface ScenarioResult {
  scenario_id?: number;
  task_id?: number;
  scene_label: string;
  roles: string;
  goal: string;
  context_constraints: string;
  evaluation_criteria: string;
  variant_plot: string;
  opening_line?: string;
  closing_line?: string;
}

export async function analyzeScenario(image_path: string): Promise<ScenarioResult> {
  return request<ScenarioResult>("/api/scenario/analyze", { image_path });
}

// ---- 上传图片 ----
export async function uploadImage(file: File): Promise<{ image_url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/upload/image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

// ---- 产出诊断 ----
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

// ---- 学习材料包 ----
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

// ---- 练习题 ----
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

// ---- 双轨评价（类型定义，供 store 使用）----
export interface DimensionScore {
  attempt1: number;
  attempt2: number;
}

export interface EvaluateResult {
  dimension_scores: Record<string, DimensionScore>;
  problem_improved: string;
  full_report: string;
}

// ---- 对话 API ----
export interface ChatStartResponse {
  ai_text: string;
  ai_audio_url: string;
}

export interface TurnFeedback {
  scores?: { grammar: number; vocabulary: number; coherence: number };  // 三维文本评分（0-100）
  short_comment: string;   // 15-80 字短评
}

export interface ChatTurnResponse {
  ai_text: string;
  ai_audio_url: string;
  is_final: boolean;
  turn_feedback?: TurnFeedback;
  user_text?: string;
  llm_error?: string;
  asr_error?: string;
}

export async function chatStart(
  scene_label: string,
  roles: string,
  goal: string,
  evaluation_criteria?: string,
  variant_context?: string,
  opening_line?: string
): Promise<ChatStartResponse> {
  return request<ChatStartResponse>("/api/chat/start", { 
    scene_label, 
    roles, 
    goal,
    evaluation_criteria: evaluation_criteria || "",
    is_variant: !!variant_context,
    variant_context: variant_context || "",
    opening_line: opening_line || ""
  });
}

export async function chatTurn(
  user_text: string,
  conversation_history: any[],
  scene_label: string,
  roles: string,
  goal?: string,
  evaluation_criteria?: string,
  closing_line?: string
): Promise<ChatTurnResponse> {
  return request<ChatTurnResponse>("/api/chat/turn", {
    user_text,
    conversation_history,
    scene_label,
    roles,
    goal: goal || "",
    evaluation_criteria: evaluation_criteria || "",
    closing_line: closing_line || ""
  });
}
