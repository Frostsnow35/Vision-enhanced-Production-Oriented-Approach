"use client";

import { useState, useRef, useEffect, useMemo, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { uploadImage, type ScenarioResult, buildImageUrl, analyzeScenario, pollScenarioStatus } from "@/lib/api";
import { usePOA, getScenarioHistory, addScenarioToHistory, removeScenarioFromHistory, selectScenario, createScenarioFromResult, type ScenarioHistoryItem } from "@/lib/store";

/* ============================================================
   Toast
   ============================================================ */
interface ToastItem { id: number; message: string; type: "error" | "success" }

export default function ScenarioPage() {
  const t = useTranslations();
  const router = useRouter();
  const { setScenarioResult } = usePOA();

  // 场景分析趣味提示词（通过翻译动态获取）
  const funTips: string[] = useMemo(() => {
    const result = t("scenario.fun_tips");
    return Array.isArray(result) ? result : [];
  }, [t]);

  // ---- Upload state ----
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Submit ----
  const [submitting, setSubmitting] = useState(false);

  // ---- 趣味提示词轮换 ----
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (!submitting) {
      setTipIndex(0);
      return;
    }
    if (funTips.length === 0) return;
    const id = setInterval(() => {
      setTipIndex((i) => (i + 1) % funTips.length);
    }, 3000);
    return () => clearInterval(id);
  }, [submitting, funTips]);

  // ---- History ----
  const [history, setHistory] = useState<ScenarioHistoryItem[]>([]);
  useEffect(() => {
    setHistory(getScenarioHistory());
  }, []);

  const refreshHistory = () => setHistory(getScenarioHistory());

  // ---- Toast ----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);
  const addToast = (message: string, type: "error" | "success" = "error") => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  };

  // ---- 文件校验 ----
  function validateFile(file: File): string | null {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.type)) return t("scenario.invalid_format");
    if (file.size > 10 * 1024 * 1024) return t("scenario.file_too_large");
    return null;
  }

  // ---- 图片压缩（Canvas API，上传前缩放以减少 VLM 推理时间）----
  async function compressImage(file: File): Promise<File> {
    const MAX_DIM = 800;
    const QUALITY = 0.6;
    // 小文件不压缩（中国大陆到 Railway 美国跨国传输，减小体积是关键）
    if (file.size < 150 * 1024) return file;

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        if (w <= MAX_DIM && h <= MAX_DIM) { resolve(file); return; }
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        const cw = Math.round(w * ratio);
        const ch = Math.round(h * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
          resolve(compressed.size < file.size ? compressed : file);
        }, "image/jpeg", QUALITY);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function handleFile(file: File) {
    setUploadError("");
    const err = validateFile(file);
    if (err) { setUploadError(err); addToast(err, "error"); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const compressed = await compressImage(file);
    setUploadedFile(compressed);
    setPreviewUrl(URL.createObjectURL(compressed));
  }

  // ---- 拖拽 ----
  function onDragOver(e: DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: DragEvent) { e.preventDefault(); setIsDragging(false); }
  function onDrop(e: DragEvent) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }
  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) handleFile(f); }
  function removeUpload() { if (previewUrl) URL.revokeObjectURL(previewUrl); setUploadedFile(null); setPreviewUrl(null); setUploadError(""); }

  // ---- 轮询等待分析完成（每次请求短连接，适配移动端） ----
  async function waitForAnalysis(taskId: string): Promise<ScenarioResult> {
    const maxPolls = 100; // 100 * 3s = 300s max
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const status = await pollScenarioStatus(taskId);
      if (status.status === "completed" && status.result) {
        return status.result;
      }
      if (status.status === "failed") {
        throw new Error(status.error || t("scenario.analyze_failed", { error: t("common.error_unknown") }));
      }
      if (status.status === "not_found") {
        throw new Error(t("common.server_error"));
      }
    }
    throw new Error(t("scenario.timeout"));
  }

  // ---- 处理分析结果的公共逻辑 ----
  function handleAnalysisResult(result: ScenarioResult, imageUrl: string) {
    ["diagnosis", "diagnosis2", "conversationText", "conversationText2", "facilitate_progress"].forEach(k => localStorage.removeItem(k));
    const currentTask = {
      scene_label: result.scene_label,
      roles: result.roles,
      goal: result.goal,
      evaluation_criteria: result.evaluation_criteria,
      variant_plot: result.variant_plot,
      opening_line: result.opening_line || "",
      closing_line: result.closing_line || "",
    };
    localStorage.setItem("currentTask", JSON.stringify(currentTask));
    const historyItem = createScenarioFromResult(result, imageUrl);
    addScenarioToHistory(historyItem);
    selectScenario(historyItem.id);
    setScenarioResult(result);
    addToast(t("scenario.analysis_done"), "success");
    setTimeout(() => router.push("/task"), 600);
  }

  // ---- 生成交际任务 ----
  async function handleGenerate() {
    if (submitting) return;
    if (!uploadedFile) return;
    setSubmitting(true);
    try {
      const { image_url } = await uploadImage(uploadedFile);
      const { task_id } = await analyzeScenario(image_url);
      const result = await waitForAnalysis(task_id);
      handleAnalysisResult(result, image_url);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        addToast(t("scenario.timeout"), "error");
      } else {
        addToast(t("scenario.analyze_failed", { error: err.message ?? t("common.error_unknown") }), "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- 选择历史场景 ----
  function handleSelectHistory(id: string) {
    const item = selectScenario(id);
    if (item) {
      setScenarioResult(item.task);
      addToast(t("scenario.selected_navigating"), "success");
      setTimeout(() => router.push("/task"), 400);
    }
  }

  function handleDeleteHistory(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(t("scenario.delete_confirm"))) return;
    removeScenarioFromHistory(id);
    refreshHistory();
  }

  async function handleReanalyze(item: ScenarioHistoryItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (submitting) return;
    setSubmitting(true);
    try {
      const { task_id } = await analyzeScenario(item.imageUrl);
      const result = await waitForAnalysis(task_id);
      handleAnalysisResult(result, item.imageUrl);
      refreshHistory();
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        addToast(t("scenario.timeout"), "error");
      } else {
        addToast(t("scenario.analyze_failed", { error: err.message ?? t("common.error_unknown") }), "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return t("scenario.just_now");
    if (diff < 3600000) return t("scenario.minutes_ago", { min: Math.floor(diff / 60000) });
    if (diff < 86400000) return t("scenario.hours_ago", { h: Math.floor(diff / 3600000) });
    return d.toLocaleDateString("zh-CN");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Loading Modal：submitting 时全屏模糊遮罩 + 居中卡片 + 趣味提示词轮换 */}
      {submitting && (
        <div className="fixed inset-0 z-50 backdrop-blur-md bg-background/80 flex items-center justify-center">
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
            {/* 旋转图标 */}
            <div className="flex justify-center mb-4">
              <svg className="size-12 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" className="opacity-75" />
              </svg>
            </div>
            {/* 标题 */}
            <h2 className="text-center text-lg font-semibold text-card-foreground">
              {t("scenario.analyzing_title")}
            </h2>
            {/* 趣味提示词（每 3 秒轮换） */}
            {funTips.length > 0 && (
              <p
                key={tipIndex}
                className="mt-4 text-center text-sm text-muted-foreground min-h-[2.5rem] animate-in fade-in duration-500"
              >
                {funTips[tipIndex]}
              </p>
            )}
            {/* 三个跳动小圆点 */}
            <div className="mt-4 flex items-center justify-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
            {/* 进度点（轮换指示） */}
            {funTips.length > 0 && (
              <div className="mt-3 flex items-center justify-center gap-1">
                {funTips.map((_, i) => (
                  <span
                    key={i}
                    className={`size-1 rounded-full transition-all duration-300 ${
                      i === tipIndex ? "bg-primary w-4" : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.type === "error" ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
          }`}>
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== toast.id))} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>

      {/* 标题 */}
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">{t("scenario.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("scenario.subtitle")}</p>
      </header>

      {/* 上传区域 */}
      <div className="min-h-[280px] flex flex-col items-center justify-center rounded-xl border border-border bg-card p-6 shadow-sm">
        {previewUrl ? (
          <div className="w-full space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
              <img src={previewUrl} alt={t("scenario.preview")} className="mx-auto max-h-64 w-full object-contain" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("scenario.image_ready")}</p>
              <Button variant="outline" size="sm" onClick={removeUpload}>{t("scenario.remove_reselect")}</Button>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-3">
            <label
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/50 hover:bg-muted/20"
              }`}
            >
              <Upload className={`w-12 h-12 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground/40"}`} />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{isDragging ? t("scenario.drop_hint") : t("scenario.drag_hint")}</p>
                <p className="text-xs text-muted-foreground/60">{t("scenario.format_hint")}</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={onFileInputChange} className="hidden" />
            </label>
            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
          </div>
        )}
      </div>

      {/* 提交按钮 */}
      <Button size="lg" className="w-full" disabled={!uploadedFile || submitting} onClick={handleGenerate}>
        {submitting ? (
          <span className="flex items-center gap-2">
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
            </svg>
            {t("scenario.analyzing")}
          </span>
        ) : t("scenario.generate_task")}
      </Button>

      {/* 历史场景列表 */}
      {history.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-card-foreground">{t("scenario.history")}</h2>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{history.length}</span>
          </div>

          <div className="flex gap-3 pb-2">
            {history.map((item) => (
              <div
                key={item.id}
                onClick={() => handleSelectHistory(item.id)}
                className="shrink-0 w-40 bg-card rounded-lg border border-border p-3 cursor-pointer hover:shadow-md transition-shadow"
              >
                {/* 缩略图 */}
                <div className="flex size-full aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted mb-2">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl.startsWith("http") ? item.imageUrl : buildImageUrl(item.imageUrl)}
                      alt={item.sceneLabel}
                      className="size-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <svg className="size-8 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  )}
                </div>

                {/* 信息 */}
                <p className="text-xs font-medium text-card-foreground truncate">{item.sceneLabel}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/50">{formatTime(item.createdAt)}</p>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 mt-2">
                  <span
                    onClick={(e) => handleReanalyze(item, e)}
                    className="inline-flex items-center justify-center size-6 cursor-pointer rounded text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary"
                    title={t("scenario.reanalyze")}
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </span>
                  <span
                    onClick={(e) => handleDeleteHistory(item.id, e)}
                    className="inline-flex items-center justify-center size-6 cursor-pointer rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={t("scenario.delete")}
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
