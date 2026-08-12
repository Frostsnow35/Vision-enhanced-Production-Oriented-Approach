"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * 内联加载提示：在内容应出现位置显示"稍等"友好提示。
 * - 4 条文案轮换（每 2.5 秒切换）
 * - shimmer 动画
 * - props.show=false 时返回 null
 */

export default function InlineLoadingHint({
  show = true,
  message,
  height = "h-32",
}: {
  show?: boolean;
  message?: string;
  height?: string;
}) {
  const t = useTranslations("common");
  const TIPS = [
    t("loading_tip_1"),
    t("loading_tip_2"),
    t("loading_tip_3"),
    t("loading_tip_4"),
  ];
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (!show || message) return;
    const id = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 2500);
    return () => clearInterval(id);
  }, [show, message, TIPS.length]);

  if (!show) return null;

  const currentMessage = message ?? TIPS[tipIndex];

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
