"use client";

import type { GapItem } from "@/lib/api";

export function GapList({
  gaps,
  attempt,
}: {
  gaps: GapItem[];
  attempt: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm space-y-4">
      <h2 className="text-xl font-semibold text-card-foreground">
        第 {attempt} 次作答诊断 — 发现 {gaps.length} 项不足
      </h2>
      <div className="space-y-4">
        {gaps.map((g, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                {g.label}
              </span>
            </div>
            {g.evidence_sentence && (
              <p className="text-sm">
                <span className="text-muted-foreground">原文: </span>
                <span className="italic text-card-foreground">
                  "{g.evidence_sentence}"
                </span>
              </p>
            )}
            {g.explanation && (
              <p className="text-sm text-muted-foreground">{g.explanation}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
