"use client";

import { useRef, useEffect } from "react";

interface Props {
  isRecording: boolean;
}

/**
 * 录音波形可视化 —— 纯 Canvas 数学动画，不创建 AudioContext。
 * 避免与 MediaRecorder 争抢麦克风流（尤其 Android Chrome 上会导致静音）。
 */
export default function RecordingWaveform({ isRecording }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;

    const barCount = 20;
    const barWidth = (W / barCount) * 0.6;
    const gap = (W / barCount) * 0.4;

    function draw() {
      animRef.current = requestAnimationFrame(draw);

      const t = Date.now() / 300;
      ctx!.clearRect(0, 0, W, H);

      for (let i = 0; i < barCount; i++) {
        const pct = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t + i * 0.55));
        const barHeight = Math.max(4, pct * H);
        const x = i * (barWidth + gap);
        const y = (H - barHeight) / 2;

        const r = Math.round(59 + pct * 100);
        const g = Math.round(130 + pct * 40);
        const b = Math.round(246 - pct * 60);

        ctx!.fillStyle = `rgb(${r},${g},${b})`;
        ctx!.beginPath();
        ctx!.roundRect(x, y, barWidth, barHeight, 2);
        ctx!.fill();
      }
    }

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [isRecording]);

  if (!isRecording) return null;

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={48}
      className="w-full h-12 rounded-lg bg-muted/30"
    />
  );
}
