"use client";

import { useEffect, useRef, useState } from "react";
import { segmentForClickable, translateWord, type DictResult } from "@/lib/translation";

interface ClickableEnglishProps {
  text: string;
  className?: string;
}

/**
 * 把英文文本渲染为可点击词的 React 组件
 * - 每个英文词是可点的，hover/点击弹出 WordTooltip
 * - 仅当 token 长度 ≥ 2 时可点（a, I 跳过）
 */
export default function ClickableEnglish({ text, className }: ClickableEnglishProps) {
  const segs = segmentForClickable(text);
  return (
    <span className={className}>
      {segs.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        // word
        if (seg.value.length < 2) return <span key={i}>{seg.value}</span>;
        return <WordSpan key={i} word={seg.value} />;
      })}
    </span>
  );
}

function WordSpan({ word }: { word: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [data, setData] = useState<DictResult | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 6 });
    setOpen(true);
    if (!data) {
      setLoading(true);
      const r = await translateWord(word);
      setData(r);
      setLoading(false);
    }
  };

  return (
    <>
      <span
        ref={ref}
        onClick={handleClick}
        className="cursor-pointer rounded-sm px-0.5 -mx-0.5 hover:bg-primary/10 transition-colors"
        title="点击查看翻译"
      >
        {word}
      </span>
      {open && pos && (
        <div
          ref={containerRef}
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: pos.x, top: pos.y }}
        >
          <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg min-w-[120px] max-w-[260px]">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-sm font-semibold">{word}</span>
              {data?.phonetic && <span className="text-xs text-muted-foreground font-mono">{data.phonetic}</span>}
            </div>
            <div className="text-sm">
              {loading ? (
                <span className="text-muted-foreground">翻译中…</span>
              ) : (
                <span>{data?.translation || "（无）"}</span>
              )}
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 size-2 rotate-45 bg-card border-r border-b border-border" />
          </div>
        </div>
      )}
    </>
  );
}
