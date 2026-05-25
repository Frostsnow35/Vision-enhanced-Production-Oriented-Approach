"use client";

import { useState, useRef, useCallback, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { analyzeScenario, uploadImage, type ScenarioResult } from "@/lib/api";
import { usePOA } from "@/lib/store";

/* ============================================================
   样例照片数据
   ============================================================ */
interface SamplePhoto {
  id: string;
  label: string;
  path: string;
  gradient: string;   // 卡片背景渐变
}

const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: "cafe",
    label: "咖啡厅",
    path: "/samples/cafe.jpg",
    gradient: "from-amber-100 via-orange-50 to-yellow-100 dark:from-amber-950 dark:via-orange-950 dark:to-yellow-950",
  },
  {
    id: "library",
    label: "图书馆",
    path: "/samples/library.jpg",
    gradient: "from-stone-100 via-amber-50 to-stone-200 dark:from-stone-900 dark:via-amber-950 dark:to-stone-950",
  },
  {
    id: "restaurant",
    label: "餐厅",
    path: "/samples/restaurant.jpg",
    gradient: "from-rose-100 via-red-50 to-orange-100 dark:from-rose-950 dark:via-red-950 dark:to-orange-950",
  },
  {
    id: "hospital",
    label: "医院",
    path: "/samples/hospital.jpg",
    gradient: "from-sky-100 via-blue-50 to-cyan-100 dark:from-sky-950 dark:via-blue-950 dark:to-cyan-950",
  },
  {
    id: "airport",
    label: "机场",
    path: "/samples/airport.jpg",
    gradient: "from-indigo-100 via-blue-50 to-sky-100 dark:from-indigo-950 dark:via-blue-950 dark:to-sky-950",
  },
  {
    id: "mall",
    label: "商场",
    path: "/samples/mall.jpg",
    gradient: "from-purple-100 via-pink-50 to-fuchsia-100 dark:from-purple-950 dark:via-pink-950 dark:to-fuchsia-950",
  },
];

/* ============================================================
   Simple Toast
   ============================================================ */
interface ToastItem {
  id: number;
  message: string;
  type: "error" | "success";
}

/* ============================================================
   Scene icons as inline SVG
   ============================================================ */
function SceneIcon({ id }: { id: string }) {
  const icons: Record<string, ReactNode> = {
    cafe: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 40V12a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4h4a8 8 0 0 1 0 16h-4v8" />
        <path d="M34 16h4a4 4 0 0 1 0 8h-4" />
        <path d="M16 22v4m8-6v6m-8 8h12" />
      </svg>
    ),
    library: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 38V10a2 2 0 0 1 2-2h10l4 6h10a2 2 0 0 1 2 2v22" />
        <path d="M6 38h36v4H6zM14 16h4M14 22h8M14 28h12" />
      </svg>
    ),
    restaurant: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 6v20a8 8 0 0 0 8 8h0a8 8 0 0 0 8-8V6" />
        <path d="M16 14h16M20 6v28M28 6v28M8 42h32" />
        <circle cx="24" cy="34" r="2" />
      </svg>
    ),
    hospital: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 12h32v24a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V12Z" />
        <path d="M18 20h12M24 14v12" />
        <path d="M6 12h36M14 40v4m20-4v4" />
      </svg>
    ),
    airport: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 6v28l-14 8h28L24 34Z" />
        <path d="M10 34 6 42h36l-4-8" />
        <circle cx="24" cy="6" r="3" />
      </svg>
    ),
    mall: (
      <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 18h32v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V18Z" />
        <path d="M8 18 12 6h24l4 12" />
        <path d="M16 24v8m8-4v4m8-8v8" />
        <path d="M31 10H17" />
      </svg>
    ),
  };
  return icons[id] ?? icons.cafe;
}

/* ============================================================
   Page Component
   ============================================================ */
export default function ScenarioPage() {
  const router = useRouter();
  const { setScenarioResult } = usePOA();

  // ---- Tab ----
  const [tab, setTab] = useState<"samples" | "upload">("samples");

  // ---- Sample selection ----
  const [selectedSample, setSelectedSample] = useState<SamplePhoto | null>(null);

  // ---- Upload state ----
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Submit ----
  const [submitting, setSubmitting] = useState(false);

  // ---- Toast ----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);

  const addToast = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- 本地上传：文件校验 ----
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
    // 释放旧的预览 URL
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSelectedSample(null); // 取消样例选择
  }

  // ---- 拖拽事件 ----
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

  // ---- 点击上传 ----
  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  // ---- 移除已上传文件 ----
  function removeUpload() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(null);
    setPreviewUrl(null);
    setUploadError("");
  }

  // ---- 是否已选照片 ----
  const hasSelection = tab === "samples" ? selectedSample !== null : uploadedFile !== null;

  // ---- 生成交际任务 ----
  async function handleGenerate() {
    setSubmitting(true);
    try {
      let imagePath: string;

      if (tab === "samples" && selectedSample) {
        imagePath = selectedSample.path;
      } else if (tab === "upload" && uploadedFile) {
        const { image_url } = await uploadImage(uploadedFile);
        imagePath = image_url;
      } else {
        return;
      }

      const result: ScenarioResult = await analyzeScenario(imagePath);
      setScenarioResult(result);
      addToast("场景分析完成，正在跳转...", "success");
      // 稍微延迟让 toast 可见
      setTimeout(() => router.push("/task"), 600);
    } catch (err: any) {
      addToast(err.message ?? "请求失败，请确认后端已启动", "error");
    } finally {
      setSubmitting(false);
    }
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* ---- Toast 容器 ---- */}
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

      {/* ---- 页面标题 ---- */}
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-card-foreground sm:text-3xl">
          选择场景照片
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          上传或选择一张真实场景照片，系统将为你生成交际任务
        </p>
      </header>

      {/* ---- Tab 切换 ---- */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
          <button
            onClick={() => setTab("samples")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
              tab === "samples"
                ? "bg-background text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-card-foreground"
            }`}
          >
            样例照片库
          </button>
          <button
            onClick={() => setTab("upload")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
              tab === "upload"
                ? "bg-background text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-card-foreground"
            }`}
          >
            本地上传
          </button>
        </div>
      </div>

      {/* ---- 内容区 ---- */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {tab === "samples" ? (
          <SampleGrid
            photos={SAMPLE_PHOTOS}
            selectedId={selectedSample?.id ?? null}
            onSelect={(p) => {
              setSelectedSample(p);
              // 切换到样例时清除上传
              removeUpload();
            }}
          />
        ) : (
          <UploadZone
            previewUrl={previewUrl}
            isDragging={isDragging}
            uploadError={uploadError}
            fileInputRef={fileInputRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onFileInputChange={onFileInputChange}
            onRemove={removeUpload}
          />
        )}
      </div>

      {/* ---- 提交按钮 ---- */}
      <Button
        size="lg"
        className="w-full"
        disabled={!hasSelection || submitting}
        onClick={handleGenerate}
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
            </svg>
            分析中...
          </span>
        ) : (
          "生成交际任务"
        )}
      </Button>
    </div>
  );
}

/* ============================================================
   样例照片网格
   ============================================================ */
function SampleGrid({
  photos,
  selectedId,
  onSelect,
}: {
  photos: SamplePhoto[];
  selectedId: string | null;
  onSelect: (p: SamplePhoto) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => {
        const isSelected = selectedId === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className={`group relative flex flex-col items-center gap-2 rounded-xl bg-gradient-to-br ${p.gradient} p-5 transition-all duration-200 focus:outline-none ${
              isSelected
                ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md scale-[1.02]"
                : "hover:shadow-md hover:scale-[1.01] border border-border/50"
            }`}
          >
            {/* 选中勾 */}
            {isSelected && (
              <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                ✓
              </span>
            )}
            {/* 场景图标 */}
            <span
              className={`transition-colors ${
                isSelected
                  ? "text-foreground"
                  : "text-muted-foreground/60 group-hover:text-muted-foreground"
              }`}
            >
              <SceneIcon id={p.id} />
            </span>
            {/* 标签 */}
            <span
              className={`text-sm font-medium transition-colors ${
                isSelected
                  ? "text-card-foreground"
                  : "text-muted-foreground group-hover:text-card-foreground"
              }`}
            >
              {p.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   本地上传区域
   ============================================================ */
function UploadZone({
  previewUrl,
  isDragging,
  uploadError,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInputChange,
  onRemove,
}: {
  previewUrl: string | null;
  isDragging: boolean;
  uploadError: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  // 已上传 → 显示预览
  if (previewUrl) {
    return (
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
          <Button variant="outline" size="sm" onClick={onRemove}>
            移除并重新选择
          </Button>
        </div>
      </div>
    );
  }

  // 未上传 → 拖拽/点击区域
  return (
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
        {/* 上传图标 */}
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

        {/* 隐藏的原生文件选择器 */}
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
  );
}
