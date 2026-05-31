"use client";

import { useState, useRef, useCallback, useEffect, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { analyzeScenario, uploadImage, type ScenarioResult, type VLMError } from "@/lib/api";
import { usePOA } from "@/lib/store";

interface ToastItem {
  id: number;
  message: string;
  type: "error" | "success";
}

const LOADING_PHASES = [
  { key: "uploading", label: "正在上传图片…", detail: "图片安全传输至服务器" },
  { key: "analyzing", label: "AI 正在分析场景…", detail: "豆包视觉模型识别画面中的场所、人物和物体" },
  { key: "generating", label: "正在生成交际任务…", detail: "基于 POA 产出导向法构建任务框架" },
];

const LOADING_TIPS = [
  "正在召唤智能教学助手…",
  "豆包 AI 正在仔细端详你的照片…",
  "别急，好任务需要慢慢打磨…",
  "AI 正在思考怎么给你最好的练习体验…",
  "快好了，一个专属交际任务即将出炉…",
];

export default function ScenarioPage() {
  const router = useRouter();
  const { setScenarioResult } = usePOA();

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submittingPhase, setSubmittingPhase] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);

  useEffect(() => {
    if (submitting) {
      timerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
      tipTimerRef.current = setInterval(() => {
        setTipIndex((s) => (s + 1) % LOADING_TIPS.length);
      }, 4000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (tipTimerRef.current) clearInterval(tipTimerRef.current);
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (tipTimerRef.current) clearInterval(tipTimerRef.current);
    };
  }, [submitting]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
  };

  const addToast = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  function validateFile(file: File): string | null {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.type)) {
      return "仅支持 JPG / PNG 格式的图片";
    }
    if (file.size > 5 * 1024 * 1024) {
      return "图片大小不能超过 5MB";
    }
    return null;
  }

  function handleFile(file: File) {
    setUploadError("");
    const err = validateFile(file);
    if (err) {
      setUploadError(err);
      addToast(err, "error");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function removeUpload() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(null);
    setPreviewUrl(null);
    setUploadError("");
  }

  async function handleGenerate() {
    if (!uploadedFile) return;
    setSubmitting(true);
    try {
      setSubmittingPhase("uploading");
      const { image_url } = await uploadImage(uploadedFile);
      setSubmittingPhase("analyzing");
      const result: ScenarioResult = await analyzeScenario(image_url);
      setSubmittingPhase("generating");
      await new Promise((r) => setTimeout(r, 400));
      setScenarioResult(result);
      addToast("场景分析完成，正在跳转…", "success");
      setTimeout(() => router.push("/task"), 600);
    } catch (err: any) {
      const vlmError: VLMError | undefined = (err as any).vlmError;
      if (vlmError) {
        const errorLabels: Record<string, string> = {
          api_key_missing: "API Key 未配置",
          network_timeout: "网络请求超时",
          network_error: "网络连接失败",
          http_error: "模型服务异常",
          json_parse_error: "模型返回解析失败",
          file_not_found: "图片文件丢失",
          file_read_error: "图片读取失败",
        };
        const errorLabel = errorLabels[vlmError.error_type] || vlmError.error_type;
        const msg = `AI 服务不可用：${errorLabel} — ${vlmError.message}`;
        const fullMsg = vlmError.suggestion ? `${msg} → ${vlmError.suggestion}` : msg;
        addToast(fullMsg, "error");
      } else {
        addToast(err.message ?? "请求失败，请确认后端已启动", "error");
      }
    } finally {
      setSubmitting(false);
      setSubmittingPhase("");
    }
  }

  const currentPhase = LOADING_PHASES.find((p) => p.key === submittingPhase);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-top-2 ${
              t.type === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-current opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <header className={`text-center transition-opacity duration-300 ${submitting ? "opacity-30" : ""}`}>
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          上传场景照片
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          上传一张真实场景照片，AI 将识别场景并为你生成专属交际任务
        </p>
      </header>

      <div className={`relative rounded-xl border border-border bg-card p-6 shadow-sm transition-opacity duration-300 ${submitting ? "opacity-30" : ""}`}>
        {previewUrl ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
              <img
                src={previewUrl}
                alt="上传预览"
                className="mx-auto max-h-64 w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">图片已就绪</p>
              <Button variant="outline" size="sm" onClick={removeUpload} disabled={submitting}>
                移除并重新选择
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30 hover:bg-muted/20"
              }`}
            >
              <svg
                className={`size-10 transition-colors ${
                  isDragging ? "text-primary" : "text-muted-foreground/50"
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>

              <div className="space-y-1">
                <p className="text-sm font-medium text-card-foreground">
                  {isDragging ? "释放以上传图片" : "拖拽图片到此处，或点击选择"}
                </p>
                <p className="text-xs text-muted-foreground">
                  支持 JPG / PNG 格式，单张 ≤ 5MB
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={onFileInputChange}
                className="hidden"
              />
            </label>

            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
          </div>
        )}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!uploadedFile || submitting}
        onClick={handleGenerate}
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
            </svg>
            {currentPhase?.label || "处理中…"}
          </span>
        ) : (
          "生成交际任务"
        )}
      </Button>

      {/* ---- 全屏加载遮罩 ---- */}
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
            {/* 进度条 */}
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-full origin-left animate-[loadingProgress_2s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>

            {/* 图片缩略图 */}
            {previewUrl && (
              <div className="mx-auto mb-5 size-20 overflow-hidden rounded-xl border border-border shadow-sm">
                <img
                  src={previewUrl}
                  alt="正在分析"
                  className="size-full object-cover"
                />
              </div>
            )}

            {/* 阶段标题 */}
            <h3 className="text-center text-lg font-semibold text-card-foreground">
              {currentPhase?.label || "处理中…"}
            </h3>

            {/* 阶段详情 */}
            <p className="mt-1.5 text-center text-sm text-muted-foreground">
              {currentPhase?.detail || ""}
            </p>

            {/* 动态提示 */}
            <div className="mt-4 h-5 text-center">
              <p
                key={tipIndex}
                className="text-xs text-muted-foreground/70 animate-in fade-in duration-300"
              >
                {LOADING_TIPS[tipIndex]}
              </p>
            </div>

            {/* 已用时间 */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50">
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>已等待 {formatElapsed(elapsed)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
