/**
 * API 客户端 —— 封装对后端所有接口的 fetch 调用。
 * 生产环境（Vercel）通过 Next.js rewrite 代理到 Railway，避免大陆用户直连 railway.app 被 GFW 阻断。
 * 本地开发直连 localhost:8000。
 * 可通过环境变量 NEXT_PUBLIC_API_BASE 强制覆盖。
 */
export const PRODUCTION_BACKEND = "https://poa-backend-production-c371.up.railway.app";
const LOCAL_BACKEND = "http://localhost:8000";

// 生产环境直连后端 Railway URL（CORS 已开放 *），本地开发直连 localhost
export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "production" ? PRODUCTION_BACKEND : LOCAL_BACKEND);

const DEFAULT_TIMEOUT = 60000; // 60s，LLM 调用默认超时（文本模型通常 30-60s）

/**
 * 通用 POST 请求封装（JSON 请求体 → JSON 响应），带超时。
 */
async function request<T>(path: string, body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`API error ${res.status}: ${errText}`);
  }
  return res.json();
}

/**
 * fetchWithTimeout —— 通用 GET 请求，带超时。
 */
async function fetchWithTimeout<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
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

/**
 * 触发场景分析。
 * - 新版后端（异步）：返回 {task_id: string, status: "processing"}
 * - 旧版后端（同步）：直接返回 ScenarioResult
 * 自动兼容两种模式。
 */
export async function analyzeScenario(image_path: string): Promise<
  | { mode: "async"; task_id: string }
  | { mode: "sync"; result: ScenarioResult }
> {
  const data = await request<any>("/api/scenario/analyze", { image_path }, 180000);

  // 新版异步响应：{task_id: "uuid", status: "processing"}
  if (typeof data.task_id === "string" && data.status === "processing") {
    return { mode: "async", task_id: data.task_id };
  }

  // 旧版同步响应：{scene_label, roles, goal, ...}
  if (data.scene_label) {
    return { mode: "sync", result: data as ScenarioResult };
  }

  throw new Error("Unknown response format from /api/scenario/analyze");
}

/**
 * 快速通道：Vercel Function 直接调用 Ark API（北京），绕过 Railway（美国）。
 * 路径: 手机 → Vercel 边缘(亚洲) → Ark API(北京)，无跨太平洋跳跃。
 * 失败时自动抛错，调用方应回退到 analyzeScenario（Railway 路径）。
 */
export async function analyzeScenarioDirect(imageBase64: string): Promise<ScenarioResult> {
  const res = await fetch("/api/proxy/scenario/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface AnalyzeStatusResponse {
  status: "processing" | "completed" | "failed" | "not_found";
  result?: ScenarioResult;
  error?: string;
}

/**
 * 轮询场景分析状态（带超时和重试，适配移动端弱网）。
 */
export async function pollScenarioStatus(task_id: string): Promise<AnalyzeStatusResponse> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const data = await fetchWithTimeout<AnalyzeStatusResponse>(
        `${BASE_URL}/api/scenario/status/${task_id}`,
        10000, // 单次轮询 10s 超时
      );
      return data;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        // 等待后重试
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Poll failed after retries");
}

// ---- 上传图片 ----
export async function uploadImage(file: File): Promise<{ image_url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/upload/image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000), // 120s，中国大陆到 Railway（美国）跨国上传需要较长时间
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
