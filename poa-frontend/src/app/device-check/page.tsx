"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type CheckState = "idle" | "checking" | "pass" | "fail";

export default function DeviceCheckPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<CheckState>("idle");
  const [micState, setMicState] = useState<CheckState>("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [micError, setMicError] = useState<string>("");
  const [spectrum, setSpectrum] = useState<number[]>(Array(10).fill(0));
  const [level, setLevel] = useState(0);

  useEffect(() => {
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAll = () => {
    try {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    } catch { /* ignore */ }
    try {
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    } catch { /* ignore */ }
    try {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    } catch { /* ignore */ }
    analyserRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const describeError = (err: any): string => {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "浏览器拒绝了摄像头/麦克风权限。请在地址栏左侧的锁形图标中允许权限后重试。";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "未检测到可用的摄像头或麦克风设备。请检查硬件连接。";
    if (name === "NotReadableError" || name === "TrackStartError") return "摄像头/麦克风被其它程序占用。请关闭其它应用后重试。";
    if (name === "OverconstrainedError") return "当前设备不满足所需参数。";
    if (name === "SecurityError") return "浏览器安全策略阻止了设备访问。";
    return err?.message || "未知错误";
  };

  const runCheck = async () => {
    stopAll();
    setCameraState("checking");
    setMicState("checking");
    setCameraError("");
    setMicError("");
    setSpectrum(Array(10).fill(0));
    setLevel(0);

    // ---- 摄像头 ----
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      camStreamRef.current = camStream;
      if (videoRef.current) {
        videoRef.current.srcObject = camStream;
        videoRef.current.play().catch(() => { /* ignore */ });
      }
      setCameraState("pass");
    } catch (err: any) {
      setCameraState("fail");
      setCameraError(describeError(err));
    }

    // ---- 麦克风 ----
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStreamRef.current = audioStream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const source = ctx.createMediaStreamSource(audioStream);
      source.connect(analyser);
      analyserRef.current = analyser;

      const timeData = new Uint8Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const BARS = 10;
      const smoothed = Array(BARS).fill(0);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(timeData);
        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        // 降低灵敏度：增加平滑系数，减少放大倍数
        const displayLevel = Math.min(rms * 2, 1);
        setLevel((prev) => prev * 0.7 + displayLevel * 0.3);

        analyserRef.current.getByteFrequencyData(freqData);
        const binCount = freqData.length;
        const buckets: number[] = [];
        for (let b = 0; b < BARS; b++) {
          const start = Math.floor((binCount * b) / BARS);
          const end = Math.floor((binCount * (b + 1)) / BARS);
          let sum = 0;
          for (let i = start; i < end; i++) sum += freqData[i];
          buckets.push(sum / Math.max(1, end - start) / 255);
        }
        for (let b = 0; b < BARS; b++) smoothed[b] = smoothed[b] * 0.5 + buckets[b] * 0.5;
        setSpectrum([...smoothed]);
        requestAnimationFrame(tick);
      };
      tick();
      setMicState("pass");
    } catch (err: any) {
      setMicState("fail");
      setMicError(describeError(err));
    }
  };

  const handleConfirm = () => {
    if (cameraState === "pass" && micState === "pass") {
      localStorage.setItem("device_check_passed", "true");
      localStorage.setItem("device_check_at", String(Date.now()));
    }
    stopAll();
    // 返回来源页（如果有 history.back），否则回首页
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  const bothPass = cameraState === "pass" && micState === "pass";

  return (
    <div className="flex min-h-[calc(100vh-100px)] flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold mb-1">设备检测</h1>
        <p className="text-sm text-muted-foreground mb-6">
          请允许浏览器使用摄像头和麦克风。检测通过后才能开启对话练习。
        </p>

        {/* 摄像头 */}
        <div className="rounded-xl border border-border bg-card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">摄像头</h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                cameraState === "pass"
                  ? "bg-emerald-100 text-emerald-700"
                  : cameraState === "fail"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {cameraState === "pass" ? "✓ 正常" : cameraState === "fail" ? "✗ 失败" : cameraState === "checking" ? "检测中..." : "未开始"}
            </span>
          </div>
          <div className="aspect-video w-full max-w-sm mx-auto rounded-lg bg-muted/50 overflow-hidden flex items-center justify-center">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            {cameraState !== "pass" && (
              <div className="absolute text-center text-xs text-muted-foreground px-4">
                {cameraState === "checking" ? "正在获取摄像头..." : cameraState === "fail" ? "摄像头未就绪" : "尚未开始检测"}
              </div>
            )}
          </div>
          {cameraError && <p className="mt-2 text-xs text-rose-600">{cameraError}</p>}
        </div>

        {/* 麦克风 */}
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">麦克风</h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                micState === "pass"
                  ? "bg-emerald-100 text-emerald-700"
                  : micState === "fail"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {micState === "pass" ? "✓ 正常" : micState === "fail" ? "✗ 失败" : micState === "checking" ? "检测中..." : "未开始"}
            </span>
          </div>
          {micState === "pass" && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">请对着麦克风说话，下方柱状条应明显波动：</p>
              <div className="h-12 flex items-end gap-1">
                {spectrum.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded transition-all duration-75"
                    style={{
                      height: `${Math.max(4, v * 100)}%`,
                      backgroundColor: v > 0.7 ? "#22c55e" : v > 0.4 ? "#84cc16" : "#3b82f6",
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-right">音量: {Math.round(level * 100)}%</p>
            </div>
          )}
          {micError && <p className="mt-2 text-xs text-rose-600">{micError}</p>}
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={runCheck} size="lg" className="w-full text-base py-6 bg-primary text-primary-foreground hover:bg-primary/90">
            {cameraState === "idle" ? "开始检测" : "重新检测"}
          </Button>
          <Button onClick={handleConfirm} disabled={!bothPass} size="lg" className="w-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-muted disabled:text-muted-foreground">
            {bothPass ? "检测通过，返回" : "请先完成检测"}
          </Button>
        </div>

        {bothPass && (
          <p className="mt-4 text-xs text-emerald-600 text-center">✓ 设备检测通过！可以开始对话练习了。</p>
        )}
      </div>
    </div>
  );
}
