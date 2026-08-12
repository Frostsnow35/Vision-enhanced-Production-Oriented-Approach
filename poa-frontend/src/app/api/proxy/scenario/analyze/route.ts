/**
 * Vercel API Route — 直接调用豆包 Ark API 进行场景图片分析。
 * 路径: 手机 → Vercel 边缘(亚洲) → Ark API(北京)
 * 相比 手机 → Vercel → Railway(美国) → Ark API 少一跳跨太平洋，速度快 3-5x。
 *
 * 环境变量: DOUBAO_API_KEY（Ark API Key，与后端共用）
 */

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const MODEL = "doubao-seed-2-0-mini-260428";
const API_KEY = process.env.DOUBAO_API_KEY;
const MAX_TOKENS = 500;

const SCENE_PROMPT = `根据照片内容，直接输出以下JSON（只输出JSON，禁止任何额外文字）：

{
  "scene_label": "具体场景名如Cafe Brew & Co.",
  "poa_task": {
    "roles": "A:普通顾客/访客/乘客等无专业背景角色; B:场景专业服务人员",
    "goal": "1个交际主目标（含产出标准如'用委婉句式点单'）",
    "context_constraints": "1~2条场景特定约束",
    "evaluation_criteria": ["维度1如'请求句式多样性'", "维度2如'信息确认的准确性'", "维度3如'回应的恰当性'"]
  },
  "variant_plot": "同场景同角色的新情节（仅改一个交际维度，如点单→纠正订单）",
  "opening_line": "B的开场白（含场景专有词+?结尾问句引导）",
  "closing_line": "B的场景化告别（≤30词）"
}

规则: A必须是无专业背景的普通人，B是专业服务方。evaluation_criteria从A角度出发，禁用'准确性''流利度'等通用标签。禁用泛化开场白/告别。`;

// ---- JSON 解析（与 Python 后端 _parse_json 逻辑一致） ----
function parseJson(raw: string): any {
  let text = raw.trim();
  // 去除 markdown 代码块
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines.length && lines[lines.length - 1].startsWith("```")) lines.pop();
    text = lines.join("\n").trim();
  }
  // 跳过 JSON 前的解释文字
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const brace = text.indexOf("{");
    const bracket = text.indexOf("[");
    const start = Math.min(
      brace === -1 ? Infinity : brace,
      bracket === -1 ? Infinity : bracket
    );
    if (start !== Infinity) text = text.slice(start);
  }
  // 提取第一个完整 JSON 对象
  if (text.startsWith("{")) {
    let depth = 0, end = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end) text = text.slice(0, end);
  } else if (text.startsWith("[")) {
    let depth = 0, end = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end) text = text.slice(0, end);
  }
  // 移除尾部逗号
  text = text.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(text);
}

// ---- 清洗 opening/closing line ----
const DIGIT_DASH_RE = /^\s*[\d]+([\s\-—_]+[\d]+)+\s*$/;
const REPEATED_DASH_RE = /[-—_]{3,}/;
const JSON_RESIDUE_RE = /[\{\}\[\]"]|"\w+":|^\s*\{|\}\s*$/;
const TIMESTAMP_DATE_RE = /\b\d{2,4}[-/]\d{1,2}[-/]\d{1,2}\b/;
const TIMESTAMP_TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\b/;
const PURE_NUMBER_RE = /\b\d{5,}\b/;

function sanitizeLine(raw: string, maxWords: number): string {
  if (!raw) return "";
  const text = raw.trim();
  if (!text) return "";
  if (DIGIT_DASH_RE.test(text) || REPEATED_DASH_RE.test(text)) return "";
  if (JSON_RESIDUE_RE.test(text)) return "";
  if (TIMESTAMP_DATE_RE.test(text) || TIMESTAMP_TIME_RE.test(text)) return "";
  if (PURE_NUMBER_RE.test(text)) return "";
  const words = text.split(/\s+/);
  if (words.length > maxWords) return words.slice(0, maxWords).join(" ");
  return text;
}

// ---- 调用 Ark API ----
async function callArkAPI(imageBase64: string): Promise<string> {
  const resp = await fetch(`${ARK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: SCENE_PROMPT },
          { type: "image_url", image_url: { url: imageBase64 } },
        ],
      }],
      max_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Ark API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    // 可能是 streaming response? 尝试从 reasoning_content 恢复
    const reasoning = data?.choices?.[0]?.message?.reasoning_content || "";
    const reasoningMatch = reasoning.match(/\{[\s\S]*"scene_label"/);
    if (reasoningMatch) return reasoningMatch[0];
    throw new Error("Ark API returned empty content");
  }
  // 去除 think 标签
  return content.replace(/<\/?think[^>]*>/g, "");
}

// ---- Route Handler ----
export async function POST(request: Request) {
  if (!API_KEY) {
    return Response.json(
      { error: "DOUBAO_API_KEY not configured on Vercel" },
      { status: 500 }
    );
  }

  let imageBase64: string;
  try {
    const body = await request.json();
    imageBase64 = body.image_base64;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return Response.json({ error: "Missing image_base64" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const raw = await callArkAPI(imageBase64);
    const p = parseJson(raw);
    const poa = p.poa_task || {};

    const ec = Array.isArray(poa.evaluation_criteria)
      ? poa.evaluation_criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")
      : "";
    const cc = Array.isArray(poa.context_constraints)
      ? poa.context_constraints.join("\n")
      : (poa.context_constraints || "");

    const rawOpening = p.opening_line || "";
    const rawClosing = p.closing_line || "";
    const opening = sanitizeLine(rawOpening, 25);
    const closing = sanitizeLine(rawClosing, 30);

    return Response.json({
      scene_label: p.scene_label || "",
      roles: poa.roles || "",
      goal: poa.goal || "",
      context_constraints: cc,
      evaluation_criteria: ec,
      variant_plot: p.variant_plot || "",
      opening_line: opening,
      closing_line: closing,
    });
  } catch (err: any) {
    console.error("[proxy/analyze] failed:", err.message);
    return Response.json(
      { error: err.message || "Analysis failed" },
      { status: 502 }
    );
  }
}

// 运行时配置：设置最长执行时间和首选区域
export const runtime = "nodejs";
export const maxDuration = 120; // Vercel Pro: 120s; Hobby 忽略此值但函数不会超时
