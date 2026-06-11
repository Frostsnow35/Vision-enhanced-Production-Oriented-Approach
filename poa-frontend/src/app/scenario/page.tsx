"use client";

import { useState, useRef, useEffect, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { uploadImage, type ScenarioResult, BASE_URL, buildImageUrl } from "@/lib/api";
import { usePOA, getScenarioHistory, addScenarioToHistory, removeScenarioFromHistory, selectScenario, createScenarioFromResult, type ScenarioHistoryItem } from "@/lib/store";

/* ============================================================
   Toast
   ============================================================ */
interface ToastItem { id: number; message: string; type: "error" | "success" }

/* ============================================================
   场景分析趣味提示词
   ============================================================ */
const FUN_TIPS = [
  "AI 正在仔细观察照片里的每一个细节...",
  "别急，好的任务需要细细打磨 ✨",
  "正在为这场对话挑选最贴合的词汇表 ☕",
  "下一步会根据你的目标推荐对话策略 💡",
  "完成分析后可直接进入录音环节 🎙",
  "提示：开口前先想清楚要达成的目标",
  "AI 正在脑补这场对话会怎么展开...",
];

export default function ScenarioPage() {
  const router = useRouter();
  const { setScenarioResult } = usePOA();

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
    const id = setInterval(() => {
      setTipIndex((i) => (i + 1) % FUN_TIPS.length);
    }, 3000);
    return () => clearInterval(id);
  }, [submitting]);

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
    if (!allowed.includes(file.type)) return "仅支持 JPG / PNG 格式的图片";
    if (file.size > 5 * 1024 * 1024) return "图片大小不能超过 5MB";
    return null;
  }

  function handleFile(file: File) {
    setUploadError("");
    const err = validateFile(file);
    if (err) { setUploadError(err); addToast(err, "error"); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  // ---- 拖拽 ----
  function onDragOver(e: DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: DragEvent) { e.preventDefault(); setIsDragging(false); }
  function onDrop(e: DragEvent) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }
  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) handleFile(f); }
  function removeUpload() { if (previewUrl) URL.revokeObjectURL(previewUrl); setUploadedFile(null); setPreviewUrl(null); setUploadError(""); }

  // ---- 生成交际任务 ----
  async function handleGenerate() {
    if (submitting) return;
    if (!uploadedFile) return;
    setSubmitting(true);
    try {
      const { image_url } = await uploadImage(uploadedFile);
      const res = await fetch(`${BASE_URL}/api/scenario/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: image_url }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        let msg = `服务器错误 (${res.status})`;
        try { const errBody = await res.json(); if (errBody?.message) msg = errBody.message; } catch {}
        throw new Error(msg);
      }
      const result: ScenarioResult = await res.json();
      // 清空旧数据
      ["diagnosis", "diagnosis2", "conversationText", "conversationText2", "facilitate_progress"].forEach(k => localStorage.removeItem(k));
      // 将 opening_line/closing_line 合并到 currentTask 并存储
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
      // 添加到历史
      const historyItem = createScenarioFromResult(result, image_url);
      addScenarioToHistory(historyItem);
      selectScenario(historyItem.id);
      setScenarioResult(result);
      addToast("场景分析完成，正在跳转...", "success");
      setTimeout(() => router.push("/task"), 600);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        addToast("图片识别超时，请稍后重试。", "error");
      } else {
        addToast(`图片识别失败，请稍后重试。（错误：${err.message ?? "未知错误"}）`, "error");
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
      addToast("已选择场景，正在进入任务...", "success");
      setTimeout(() => router.push("/task"), 400);
    }
  }

  function handleDeleteHistory(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("确定删除此场景记录？")) return;
    removeScenarioFromHistory(id);
    refreshHistory();
  }

  async function handleReanalyze(item: ScenarioHistoryItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (submitting) return;
    setSubmitting(true);
    try {
      ["diagnosis", "diagnosis2", "conversationText", "conversationText2", "facilitate_progress"].forEach(k => localStorage.removeItem(k));
      const res = await fetch(`${BASE_URL}/api/scenario/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: item.imageUrl }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        let msg = `服务器错误 (${res.status})`;
        try { const errBody = await res.json(); if (errBody?.message) msg = errBody.message; } catch {}
        throw new Error(msg);
      }
      const result: ScenarioResult = await res.json();
      // 将 opening_line/closing_line 合并到 currentTask 并存储
      const currentTask2 = {
        scene_label: result.scene_label,
        roles: result.roles,
        goal: result.goal,
        evaluation_criteria: result.evaluation_criteria,
        variant_plot: result.variant_plot,
        opening_line: result.opening_line || "",
        closing_line: result.closing_line || "",
      };
      localStorage.setItem("currentTask", JSON.stringify(currentTask2));
      const historyItem = createScenarioFromResult(result, item.imageUrl);
      addScenarioToHistory(historyItem);
      selectScenario(historyItem.id);
      setScenarioResult(result);
      refreshHistory();
      addToast("场景分析完成，正在跳转...", "success");
      setTimeout(() => router.push("/task"), 600);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        addToast("图片识别超时，请稍后重试。", "error");
      } else {
        addToast(`图片识别失败，请稍后重试。（错误：${err.message ?? "未知错误"}）`, "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
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
              正在识别场景并生成任务...
            </h2>
            {/* 趣味提示词（每 3 秒轮换） */}
            <p
              key={tipIndex}
              className="mt-4 text-center text-sm text-muted-foreground min-h-[2.5rem] animate-in fade-in duration-500"
            >
              {FUN_TIPS[tipIndex]}
            </p>
            {/* 三个跳动小圆点 */}
            <div className="mt-4 flex items-center justify-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
            {/* 进度点（轮换指示） */}
            <div className="mt-3 flex items-center justify-center gap-1">
              {FUN_TIPS.map((_, i) => (
                <span
                  key={i}
                  className={`size-1 rounded-full transition-all duration-300 ${
                    i === tipIndex ? "bg-primary w-4" : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            t.type === "error" ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
          }`}>
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>

      {/* 标题 */}
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">选择场景照片</h1>
        <p className="mt-2 text-sm text-muted-foreground">上传一张真实场景照片，系统将为你生成交际任务</p>
      </header>

      {/* 上传区域 */}
      <div className="min-h-[280px] flex flex-col items-center justify-center rounded-xl border border-border bg-card p-6 shadow-sm">
        {previewUrl ? (
          <div className="w-full space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
              <img src={previewUrl} alt="预览" className="mx-auto max-h-64 w-full object-contain" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">图片已就绪</p>
              <Button variant="outline" size="sm" onClick={removeUpload}>移除并重新选择</Button>
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
                <p className="text-sm text-muted-foreground">{isDragging ? "释放以上传图片" : "拖拽照片到此处 或 点击选择文件"}</p>
                <p className="text-xs text-muted-foreground/60">支持 JPG / PNG 格式，单张 ≤ 5MB</p>
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
            分析中...
          </span>
        ) : "生成交际任务"}
      </Button>

      {/* 历史场景列表 */}
      {history.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-card-foreground">历史场景</h2>
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
                    title="重新分析"
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </span>
                  <span
                    onClick={(e) => handleDeleteHistory(item.id, e)}
                    className="inline-flex items-center justify-center size-6 cursor-pointer rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="删除"
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
