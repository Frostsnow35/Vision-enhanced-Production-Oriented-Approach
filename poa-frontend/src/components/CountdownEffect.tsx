"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 居中倒计时发光特效。
 * - `seconds` 秒倒计时（例如 3 → 2 → 1 → GO）
 * - 自动播放完成后触发 onDone
 * - 颜色与网站主色一致（使用 Tailwind text-primary / bg-primary 工具类）
 */
export default function CountdownEffect({
  seconds = 3,
  onDone,
}: {
  seconds?: number;
  onDone?: () => void;
}) {
  const [count, setCount] = useState(seconds);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (count <= 0) {
      const t = setTimeout(() => onDoneRef.current?.(), 50);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count]);

  if (count <= 0) {
    return (
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
        <div className="animate-out fade-out zoom-out duration-500">
          <div className="text-6xl font-black text-white drop-shadow-[0_0_30px_#22d3ee]">
            GO!
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <div className="relative flex items-center justify-center" key={count}>
        {/* 多层光晕（缩小降低刺眼感） */}
        <span className="absolute size-48 rounded-full bg-cyan-400/10 blur-3xl animate-pulse" />
        <span className="absolute size-36 rounded-full bg-cyan-400/20 blur-2xl animate-pulse [animation-delay:200ms]" />
        <span className="absolute size-24 rounded-full bg-cyan-400/30 blur-xl animate-pulse [animation-delay:400ms]" />
        {/* 数字 */}
        <span
          className="relative text-[8rem] font-black leading-none text-white drop-shadow-[0_0_30px_#22d3ee] animate-in zoom-in-50 fade-in duration-300"
        >
          {count}
        </span>
      </div>
    </div>
  );
}
