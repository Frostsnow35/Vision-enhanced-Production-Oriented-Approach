"use client";

import { useRef, useEffect } from "react";

interface Props {
  stream: MediaStream | null;
  isRecording: boolean;
}

export default function RecordingWaveform({ stream, isRecording }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording || !stream || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // 移动端：跳过 AudioContext analyser，避免与 MediaRecorder 抢麦克风流
    // Android Chrome 上 createMediaStreamSource() + MediaRecorder 同时持有同一流 → 录音静音
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    if (!isMobile) {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
    }

    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      animRef.current = requestAnimationFrame(draw);

      if (analyser) {
        // 桌面端：真实波形
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        ctx!.clearRect(0, 0, W, H);

        const barCount = 40;
        const step = Math.floor(bufferLength / barCount);
        const barWidth = (W / barCount) * 0.7;
        const gap = (W / barCount) * 0.3;

        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step] ?? 0;
          const pct = value / 255;
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
      } else {
        // 移动端：简化视觉（纯 CSS 动画级，不创建 AudioContext 避免抢麦）
        const t = Date.now() / 300;
        ctx!.clearRect(0, 0, W, H);
        const barCount = 20;
        const barWidth = (W / barCount) * 0.6;
        const gap = (W / barCount) * 0.4;

        for (let i = 0; i < barCount; i++) {
          const pct = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t + i * 0.5));
          const barHeight = Math.max(4, pct * H * 0.8);
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
    }

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [isRecording, stream]);

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
