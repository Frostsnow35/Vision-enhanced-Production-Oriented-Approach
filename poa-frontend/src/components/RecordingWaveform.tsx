"use client";

import { useRef, useEffect } from "react";

interface Props {
  isRecording: boolean;
  /**
   * 页面持有的 AnalyserNode（从麦克风流读取真实频谱）。
   * 传入后波形反映实际说话音量；为 null 时回退为低幅占位动画。
   */
  analyserRef?: React.MutableRefObject<AnalyserNode | null>;
}

/**
 * 录音波形可视化 —— 读取真实音频频谱（AnalyserNode.getByteFrequencyData）。
 * 与 MediaRecorder 共享同一个 MediaStream：AnalyserNode 只分析不消费音频，两者可同时工作。
 */
export default function RecordingWaveform({ isRecording, analyserRef }: Props) {
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
    const freqData = new Uint8Array(analyserRef?.current?.frequencyBinCount ?? 2048);
    // 平滑系数：让波形变化自然，不抖动
    const smoothed = new Array(barCount).fill(0);

    function draw() {
      animRef.current = requestAnimationFrame(draw);

      ctx!.clearRect(0, 0, W, H);

      const analyser = analyserRef?.current;
      let realData: number[] | null = null;

      if (analyser) {
        analyser.getByteFrequencyData(freqData);
        const binCount = analyser.frequencyBinCount;
        const buckets: number[] = [];
        for (let b = 0; b < barCount; b++) {
          // 非线性分桶（指数 1.5）：低频桶更密集，人声能量集中在低频段
          const s = Math.min(binCount - 1, Math.floor(Math.pow(b / barCount, 1.5) * binCount));
          const e = Math.max(s + 1, Math.min(binCount, Math.floor(Math.pow((b + 1) / barCount, 1.5) * binCount)));
          let sum = 0;
          for (let i = s; i < e; i++) sum += freqData[i];
          buckets.push(sum / (e - s) / 255);
        }
        // 低频放大 + 平滑
        for (let b = 0; b < barCount; b++) {
          const boosted = Math.min(1, buckets[b] * 2.2);
          smoothed[b] = smoothed[b] * 0.55 + boosted * 0.45;
        }
        realData = smoothed;
      }

      const t = Date.now() / 300;

      for (let i = 0; i < barCount; i++) {
        let pct: number;
        if (realData) {
          pct = realData[i];
        } else {
          // 回退：analyser 不可用（如移动端跳过）时的低幅占位动画
          pct = 0.08 + 0.06 * (0.5 + 0.5 * Math.sin(t + i * 0.55));
        }
        const barHeight = Math.max(3, pct * H);
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
  }, [isRecording, analyserRef]);

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
