/**
 * 统一 API 反向代理 —— 替代 Next.js 16 的 external rewrite（生产环境已知会 500）。
 *
 * 原因：Next.js 16 的 `rewrites` 代理外部 URL 在生产（standalone）下不可靠，
 * 且 LLM 调用耗时 19~52s，会触发其约 30s 的代理超时，导致 attempt1/submit 等 POST 接口 500。
 *
 * 方案：用 Node 运行时 route handler + fetch 直接转发到后端，
 * 正确透传请求体（JSON / multipart）与响应，超时放宽到 180s（与前端 client 一致）。
 */
import { NextRequest } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://poa-backend-production-97b8.up.railway.app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180; // Vercel 备选部署时放宽到 180s；Railway 自托管忽略此值

// 后端 LLM 诊断最长约 120s，代理超时需留足余量
const PROXY_TIMEOUT_MS = 180_000;

// 逐跳头，转发时应剔除（由 fetch / 服务端重新计算）
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const target = `${BACKEND_URL}/api/${path.join("/")}${request.nextUrl.search}`;

  const reqHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      reqHeaders.set(key, value);
    }
  });

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: reqHeaders,
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    const isTimeout = name === "TimeoutError" || name === "AbortError";
    return new Response(
      JSON.stringify({
        error: isTimeout ? "proxy_timeout" : "proxy_error",
        message: isTimeout
          ? "后端响应超时，请稍后重试"
          : "代理请求失败，请稍后重试",
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });
  // Node fetch 会自动解压 gzip，去掉这两个头避免客户端二次解压
  resHeaders.delete("content-encoding");
  resHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS, proxy as HEAD };
