import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://poa-backend-production-97b8.up.railway.app";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // 注意：/api/* 不走 rewrite（Next.js 16 external rewrite 生产环境会 500），
    // 改由 src/app/api/[...path]/route.ts 统一反向代理。
    // /uploads、/samples 为静态资源 GET，仍用 rewrite 转发。
    return [
      {
        source: "/uploads/:path*",
        destination: `${BACKEND_URL}/uploads/:path*`,
      },
      {
        source: "/samples/:path*",
        destination: `${BACKEND_URL}/samples/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
