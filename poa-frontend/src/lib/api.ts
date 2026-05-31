
/**
 * API 客户端 —— 封装对后端所有接口的 fetch 调用。
 * 后端默认地址 http://localhost:8000，可通过环境变量 NEXT_PUBLIC_API_BASE 覆盖。
 */

export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/**
 * 构建图片 URL
 * 后端静态文件：/uploads/ → uploads/ 目录
 */
export function buildImageUrl(imagePath: string): string {
  if (!imagePath) return "";
  if (imagePath.startsWith("http")) return imagePath;
  
  // 过滤掉无效的样例图片路径
  if (imagePath.includes("sample_images") || imagePath.includes("/samples/")) {
    return "";
  }
  
  // 用户上传的图片：/uploads/images/xxx.jpg → 直接拼接
  if (imagePath.startsWith("/")) {
    return `${BASE_URL}${imagePath}`;
  }
  
  // 其他情况直接拼接
  return `${BASE_URL}/${imagePath}`;
}

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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

// ---- 场景分析 ----
export interface ScenarioResult {
  id?: number;
  scenario_id?: number;
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

// ---- 双轨评价 ----
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
  attempt1_text: string,
  attempt2_text: string
): Promise<EvaluateResult> {
  return request<EvaluateResult>("/api/evaluate", { attempt1_text, attempt2_text });
}

// ---- 对话 API ----
export interface ChatStartResponse {
  ai_text: string;
  ai_audio_url: string;
}

export interface ChatTurnResponse {
  ai_text: string;
  ai_audio_url: string;
  is_final: boolean;
}

export async function chatStart(
  scene_label: string,
  roles: string,
  goal: string,
  evaluation_criteria?: string,
  variant_context?: string
): Promise<ChatStartResponse> {
  return request<ChatStartResponse>("/api/chat/start", { 
    scene_label, 
    roles, 
    goal,
    evaluation_criteria: evaluation_criteria || "",
    is_variant: !!variant_context,
    variant_context: variant_context || "" 
  });
}

export async function chatTurn(
  user_text: string,
  audio_url: string,
  conversation_history: any[],
  scene_label: string,
  roles: string,
  goal?: string,
  evaluation_criteria?: string
): Promise<ChatTurnResponse> {
  return request<ChatTurnResponse>("/api/chat/turn", { 
    user_text, 
    audio_url, 
    conversation_history,
    scene_label,
    roles,
    goal: goal || "",
    evaluation_criteria: evaluation_criteria || ""
  });
}
