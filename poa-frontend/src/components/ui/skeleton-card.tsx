"use client";

import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  card?: boolean;
  circle?: boolean;
  lines?: number;
  width?: string;
  height?: string;
  className?: string;
}

export default function SkeletonCard({
  card,
  circle,
  lines = 4,
  width,
  height,
  className,
}: SkeletonCardProps) {
  return (
    <div className={cn(width || "w-full", className)}>
      {circle ? (
        <div
          className={cn("animate-pulse rounded-full bg-muted", height || "h-48")}
        />
      ) : card ? (
        <div className="rounded-xl border border-border bg-card p-6 animate-pulse">
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            {Array.from({ length: lines - 1 }).map((_, i) => (
              <div
                key={i}
                className="h-3 bg-muted rounded"
                style={{ width: `${60 + Math.random() * 30}%` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className="h-3 bg-muted rounded"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
