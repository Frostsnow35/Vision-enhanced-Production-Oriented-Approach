"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isDeviceCheckPassed, markDeviceCheckPassed, clearDeviceCheck } from "@/lib/device-check";

type CheckState = "idle" | "checking" | "pass" | "fail";

interface DeviceCheckModalProps {
  /** 是否打开（受控） */
  open: boolean;
  /** 关闭模态框（点 X 或"开始调试"时若已通过可调用） */
  onClose: () => void;
  /** 设备检查通过时的回调（用于触发后续流程） */
  onPassed?: () => void;
}

const StopIcon = ({ className }: { className?: string } = {}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-4"}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const PlayIcon = ({ className }: { className?: string } = {}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className ?? "size-5"}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const XIcon = ({ className }: { className?: string } = {}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-4"}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const CameraIcon = ({ className }: { className?: string } = {}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-7"}>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const MicIcon = ({ className }: { className?: string } = {}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-7"}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export default function DeviceCheckModal({ open, onClose, onPassed }: DeviceCheckModalProps) {
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
  const [hasResult, setHasResult] = useState(false);

  const stopAll = useCallback(() => {
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
  }, []);

  useEffect(() => {
    return () => stopAll();
  }, [stopAll]);

  // 关闭时清理
  useEffect(() => {
    if (!open) {
      stopAll();
      setCameraState("idle");
      setMicState("idle");
      setCameraError("");
      setMicError("");
      setHasResult(false);
    }
  }, [open, stopAll]);

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
    setHasResult(false);

    let cameraOk = false;
    let micOk = false;

    // ---- 摄像头 ----
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      camStreamRef.current = camStream;
      if (videoRef.current) {
        videoRef.current.srcObject = camStream;
        videoRef.current.play().catch(() => { /* ignore */ });
      }
      setCameraState("pass");
      cameraOk = true;
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
        setLevel((prev) => prev * 0.4 + Math.min(rms * 2.5, 1) * 0.6);

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
      micOk = true;
    } catch (err: any) {
      setMicState("fail");
      setMicError(describeError(err));
    }

    if (cameraOk && micOk) {
      markDeviceCheckPassed();
      setHasResult(true);
      onPassed?.();
    } else {
      setHasResult(true);
    }
  };

  const handleClose = () => {
    stopAll();
    onClose();
  };

  const handleGoFullPage = () => {
    stopAll();
    router.push("/device-check");
  };

  const handleReset = () => {
    clearDeviceCheck();
    setCameraState("idle");
    setMicState("idle");
    setCameraError("");
    setMicError("");
    setHasResult(false);
    setSpectrum(Array(10).fill(0));
    setLevel(0);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  if (!open) return null;

  const allPassed = cameraState === "pass" && micState === "pass";
  const isChecking = cameraState === "checking" || micState === "checking";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && allPassed) handleClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">设备检测</h2>
            <p className="text-xs text-muted-foreground mt-0.5">确保摄像头、麦克风正常工作后再开始对话</p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="关闭"
            aria-label="关闭"
          >
            <XIcon />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* 摄像头预览 */}
          <div className="bg-black relative aspect-video md:aspect-square">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
            {cameraState !== "pass" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
                <CameraIcon />
                <span className="text-xs">
                  {cameraState === "checking" ? "正在请求摄像头..." : cameraState === "fail" ? "摄像头不可用" : "等待开始调试"}
                </span>
              </div>
            )}
            {cameraState === "pass" && (
              <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold text-white">
                <span className="size-1.5 rounded-full bg-white" /> 摄像头就绪
              </div>
            )}
          </div>

          {/* 麦克风条 + 状态 */}
          <div className="flex flex-col p-5 space-y-4">
            {/* 状态卡片 */}
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-lg border p-3 transition-colors ${
                cameraState === "pass" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" :
                cameraState === "fail" ? "border-rose-500 bg-rose-50 dark:bg-rose-950" :
                "border-border bg-muted/30"
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${
                    cameraState === "pass" ? "bg-emerald-500" :
                    cameraState === "fail" ? "bg-rose-500" :
                    "bg-yellow-500 animate-pulse"
                  }`} />
                  <span className="text-xs font-semibold text-foreground">摄像头</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed min-h-[2.5em]">
                  {cameraState === "pass" ? "正常工作" : cameraState === "fail" ? (cameraError || "未通过") : (isChecking ? "检测中..." : "未开始")}
                </p>
              </div>
              <div className={`rounded-lg border p-3 transition-colors ${
                micState === "pass" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" :
                micState === "fail" ? "border-rose-500 bg-rose-50 dark:bg-rose-950" :
                "border-border bg-muted/30"
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${
                    micState === "pass" ? "bg-emerald-500" :
                    micState === "fail" ? "bg-rose-500" :
                    "bg-yellow-500 animate-pulse"
                  }`} />
                  <span className="text-xs font-semibold text-foreground">麦克风</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed min-h-[2.5em]">
                  {micState === "pass" ? "正常工作" : micState === "fail" ? (micError || "未通过") : (isChecking ? "检测中..." : "未开始")}
                </p>
              </div>
            </div>

            {/* 麦克风频谱 */}
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span className="flex items-center gap-1.5"><MicIcon /> 麦克风音量</span>
                <span className="font-mono">{Math.round(level * 100)}%</span>
              </div>
              <div className="flex h-12 items-end gap-1">
                {spectrum.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all duration-75"
                    style={{
                      height: `${Math.max(6, v * 100)}%`,
                      backgroundColor: v > 0.7 ? "#22c55e" : v > 0.4 ? "#84cc16" : micState === "pass" ? "#3b82f6" : "#cbd5e1",
                    }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground/70">说话时观察频谱跳动是否明显</p>
            </div>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-6 py-4">
          <button
            onClick={handleReset}
            disabled={isChecking}
            className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
          >
            重置
          </button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoFullPage}
              className="text-xs"
            >
              完整检测页
            </Button>
            {allPassed ? (
              <Button
                onClick={handleClose}
                size="lg"
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all px-6"
              >
                ✓ 完成，开始任务
              </Button>
            ) : (
              <button
                onClick={runCheck}
                disabled={isChecking}
                className="group relative inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/80 w-full px-8 py-5 text-lg font-bold text-primary-foreground shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/50 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <span className="absolute inset-0 rounded-2xl bg-primary/40 blur-xl opacity-60 group-hover:opacity-100 animate-pulse" />
                <span className="relative flex items-center gap-3">
                  {isChecking ? (
                    <>
                      <span className="size-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      检测中...
                    </>
                  ) : (
                    <>
                      <PlayIcon className="size-5" />
                      {hasResult ? "重新检测" : "开始调试"}
                    </>
                  )}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
