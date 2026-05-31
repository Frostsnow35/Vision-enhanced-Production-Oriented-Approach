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

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
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
    }

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx.close().catch(() => {});
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
