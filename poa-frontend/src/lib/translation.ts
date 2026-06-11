// AI 词典工具
// 职责：英文单词 → 中文释义 + 简版音标
// 严格 system prompt 限定为"英汉词典"角色（与对话/评估/促成学习等职责严格区分）
// 模型：豆包 doubao-seed-2.0-mini-260428（与项目其它 LLM 调用共享 key/model，但通过 prompt 隔离职责）
// 缓存：localStorage poa_word_cache，TTL 30 天

import { BASE_URL } from "@/lib/api";

const CACHE_KEY = "poa_word_cache";
const TTL_DAYS = 30;
const CACHE_VERSION = 1;

interface CacheEntry {
  v: number; // version
  translation: string;
  phonetic: string;
  at: number; // ms timestamp
}

interface CacheMap {
  [word: string]: CacheEntry;
}

function readCache(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw) as CacheMap;
    // 清理过期项
    const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const cleaned: CacheMap = {};
    for (const k of Object.keys(map)) {
      if (map[k] && map[k].v === CACHE_VERSION && now - map[k].at < ttlMs) {
        cleaned[k] = map[k];
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeCache(map: CacheMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // 忽略（quota 等）
  }
}

function normalizeWord(w: string): string {
  return w.toLowerCase().trim();
}

export interface DictResult {
  translation: string;
  phonetic: string;
}

const inFlight: Map<string, Promise<DictResult>> = new Map();

/**
 * 翻译英文单词为中文 + 音标
 * - 自动使用 localStorage 缓存（30 天）
 * - 重复请求做去重（in-flight 队列）
 * - 失败时返回 fallback，调用方可以降级处理
 */
export async function translateWord(word: string): Promise<DictResult> {
  const key = normalizeWord(word);
  if (!key) return { translation: "", phonetic: "" };
  if (key.length < 2) return { translation: key, phonetic: "" }; // 太短的（如 a, I）跳过 LLM

  // ---- 命中缓存 ----
  const cache = readCache();
  if (cache[key]) {
    return { translation: cache[key].translation, phonetic: cache[key].phonetic };
  }

  // ---- 去重 ----
  if (inFlight.has(key)) {
    return inFlight.get(key)!;
  }

  // ---- 调后端代理 ----

  const p = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: key }),
      });
      if (!resp.ok) {
        return { translation: "（翻译失败）", phonetic: "" };
      }
      const data = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      // 尝试解析 JSON；如返回含 markdown 代码块，做一次清洗
      const jsonStr = content.replace(/```json\s*/g, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(jsonStr);
        const result: DictResult = {
          translation: String(parsed.translation ?? "").slice(0, 30),
          phonetic: String(parsed.phonetic ?? "").slice(0, 50),
        };
        // 写缓存
        const cur = readCache();
        cur[key] = {
          v: CACHE_VERSION,
          translation: result.translation,
          phonetic: result.phonetic,
          at: Date.now(),
        };
        writeCache(cur);
        return result;
      } catch {
        // 解析失败：用正则从原文抽出 translation
        const m = content.match(/translation["':\s]+["']?([^"'\n,}]+)/i);
        return {
          translation: m ? m[1].trim() : content.slice(0, 20),
          phonetic: "",
        };
      }
    } catch (e) {
      return { translation: "（网络异常）", phonetic: "" };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

/**
 * 把英文文本按单词拆分，返回 [{word, start, end}]
 * 用于把 AI 消息文本渲染为可点击的词
 */
export function tokenizeEnglish(text: string): Array<{ word: string; start: number; end: number }> {
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  const re = /[A-Za-z]+(?:[''][A-Za-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * 把英文文本拆为 [文本片段/词] 的交错数组，用于 React 渲染
 * 返回 { type: "text", value } | { type: "word", value }
 */
export function segmentForClickable(text: string): Array<{ type: "text" | "word"; value: string }> {
  const tokens = tokenizeEnglish(text);
  if (tokens.length === 0) return [{ type: "text", value: text }];
  const segs: Array<{ type: "text" | "word"; value: string }> = [];
  let cursor = 0;
  for (const tk of tokens) {
    if (tk.start > cursor) {
      segs.push({ type: "text", value: text.slice(cursor, tk.start) });
    }
    segs.push({ type: "word", value: tk.word });
    cursor = tk.end;
  }
  if (cursor < text.length) {
    segs.push({ type: "text", value: text.slice(cursor) });
  }
  return segs;
}
