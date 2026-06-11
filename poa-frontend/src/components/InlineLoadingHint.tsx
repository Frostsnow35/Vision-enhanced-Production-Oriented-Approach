"use client";

import { useEffect, useState } from "react";

/**
 * 内联加载提示：在内容应出现位置显示"稍等"友好提示。
 * - 4 条文案轮换（每 2.5 秒切换）
 * - shimmer 动画
 * - props.show=false 时返回 null
 */
const DEFAULT_TIPS = [
  "稍等，AI 正在快马加鞭整理你的内容...",
  "💡 内容正在生成中",
  "别急，好内容值得等一等 ✨",
  "📚 正在为你定制个性化建议",
];

export default function InlineLoadingHint({
  show = true,
  message,
  height = "h-32",
}: {
  show?: boolean;
  message?: string;
  height?: string;
}) {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (!show || message) return;
    const id = setInterval(() => {
      setTipIndex((i) => (i + 1) % DEFAULT_TIPS.length);
    }, 2500);
    return () => clearInterval(id);
  }, [show, message]);

  if (!show) return null;

  const currentMessage = message ?? DEFAULT_TIPS[tipIndex];

  return (
    <div
      className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-border/40 bg-muted/20 ${height} animate-in fade-in duration-300`}
    >
      {/* 跳动小圆点 */}
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
      </div>
      {/* 轮换文案 */}
      <p
        key={currentMessage}
        className="text-sm text-muted-foreground animate-in fade-in duration-500"
      >
        {currentMessage}
      </p>
    </div>
  );
}
