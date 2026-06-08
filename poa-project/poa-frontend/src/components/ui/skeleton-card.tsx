"use client";

import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  /** 显示行数（默认 3） */
  lines?: number;
  /** 容器宽度（默认 full） */
  width?: string;
  /** 容器高度（默认 auto） */
  height?: string;
  /** 圆形骨架（适用于头像/图表区域） */
  circle?: boolean;
  /** 卡片骨架（带卡片边框外观） */
  card?: boolean;
  /** 额外类名 */
  className?: string;
}

export default function SkeletonCard({
  lines = 3,
  width,
  height,
  circle,
  card,
  className,
}: SkeletonCardProps) {
  if (circle) {
    return (
      <div className={cn("flex items-center justify-center", width)}>
        <div
          className={cn("animate-skeleton rounded-full", className)}
          style={{
            width: width || "80px",
            height: height || "80px",
          }}
        />
      </div>
    );
  }

  if (card) {
    return (
      <div className={cn("card p-5 space-y-4", width, className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="animate-skeleton h-4 rounded"
            style={{ width: i === lines - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-3", width, className)}
      style={{ height }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="animate-skeleton h-4 rounded"
          style={{ width: i === lines - 1 ? `${60 + Math.random() * 20}%` : "100%" }}
        />
      ))}
    </div>
  );
}
