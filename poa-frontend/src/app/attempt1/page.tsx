"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/* ============================================================
   类型定义
   ============================================================ */
interface TaskData {
  scene_label: string;
  roles: string;
  goal: string;
}

interface ConversationTurn {
  role: "user" | "ai";
  audio_url?: string;
  text?: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  return {
    user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || "未指定",
    ai: parts[1]?.trim() || "未指定",
  };
}

// AI 开场白（/api/chat/start 不可用时的降级方案）
function getOpeningLine(task: TaskData): string {
  const label = task.scene_label + task.roles;
  if (/咖啡|cafe|coffee/i.test(label)) return "Hi there! What can I get for you today?";
  if (/图书馆|library/i.test(label)) return "Welcome to the library! How can I help you?";
  if (/餐厅|restaurant/i.test(label)) return "Good evening! Do you have a reservation?";
  if (/医院|hospital/i.test(label)) return "Hello, how can I help you today?";
  if (/机场|airport/i.test(label)) return "Good morning! Where are you flying to today?";
  if (/商场|mall|shop/i.test(label)) return "Hello! Welcome! Is there anything specific you're looking for?";
  return "Hello! How can I help you today?";
}

// Mock AI 回复（/api/chat/turn 不可用时的降级方案）
function getAiReply(task: TaskData | null): string {
  const generic = [
    "Sure, what would you like?",
    "Anything else I can help you with?",
    "Let me check that for you.",
    "That'll be $5.50, please.",
    "Would you like anything to drink with that?",
    "Sorry, could you repeat that?",
  ];
  const label = (task?.scene_label ?? "") + (task?.roles ?? "");
  const specific: string[] = [];
  if (/咖啡|cafe|coffee/i.test(label)) {
    specific.push("What size — small, medium, or large?", "Hot or iced?", "Would you like to add a pastry?");
  } else if (/图书馆|library/i.test(label)) {
    specific.push("Do you have your library card?", "That book is due in two weeks.");
  } else if (/餐厅|restaurant/i.test(label)) {
    specific.push("Would you like to start with appetizers?", "How would you like that cooked?");
  } else if (/机场|airport/i.test(label)) {
    specific.push("Window or aisle seat?", "Do you have any checked bags?");
  } else if (/商场|mall|shop/i.test(label)) {
    specific.push("What size are you looking for?", "We have this in several colors.");
  } else if (/医院|hospital/i.test(label)) {
    specific.push("Do you have an appointment?", "Please describe your symptoms.");
  }
  const pool = specific.length > 0 ? [...specific, ...generic] : generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ============================================================
   页面组件
   ============================================================ */
export default function Attempt1Page() {
  const router = useRouter();

  // ---- 任务数据 ----
  const [task, setTask] = useState<TaskData | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("currentTask");
      if (raw) setTask(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // ---- 摄像头 ----
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // 摄像头：video + audio
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
        cameraStreamRef.current = camStream;
        if (videoRef.current) videoRef.current.srcObject = camStream;
        setCameraReady(true);

        // 独立音频流（用于录音，避免从摄像头流录制时出错）
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          audioStreamRef.current = audioStream;
        } catch {
          // 退而求其次：从摄像头流中提取音频轨道
          audioStreamRef.current = camStream;
        }
      } catch {
        setCameraReady(false);
      }
    })();

    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current
        ?.getTracks()
        .forEach((t) => { if (t.kind === "audio") t.stop(); });
    };
  }, []);

  // ---- 对话历史（仅内存，不显示气泡）----
  const [history, setHistory] = useState<ConversationTurn[]>([]);

  // ---- AI 状态 ----
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const startedRef = useRef(false);

  // ---- 页面加载时自动请求 AI 开场白 ----
  useEffect(() => {
    if (!task || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setAiSpeaking(true);
      try {
        const res = await fetch(`${BASE_URL}/api/chat/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: (task as any)?.id ?? 0 }),
        });
        if (res.ok) {
          const data = await res.json() as { ai_text: string; ai_audio_url?: string };
          setSubtitle(data.ai_text);
          setHistory([{ role: "ai", text: data.ai_text, audio_url: data.ai_audio_url }]);

          if (data.ai_audio_url) {
            const fullUrl = data.ai_audio_url.startsWith("/")
              ? `${BASE_URL}${data.ai_audio_url}`
              : data.ai_audio_url;
            const audio = new Audio(fullUrl);
            audio.play().catch(() => {});
            audio.onended = () => setAiSpeaking(false);
          } else {
            setTimeout(() => setAiSpeaking(false), 2500);
          }
        } else {
          throw new Error(`${res.status}`);
        }
      } catch {
        // 降级：本地 Mock 开场白
        const mockText = getOpeningLine(task);
        setSubtitle(mockText);
        setHistory([{ role: "ai", text: mockText }]);
        setTimeout(() => setAiSpeaking(false), 2500);
      }
    })();
  }, [task]);

  // ---- 语音录制（长按/按住说话）----
  const [pressing, setPressing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdBtnRef = useRef<HTMLButtonElement>(null);

  // 开始录音
  const beginRecord = useCallback(() => {
    if (!audioStreamRef.current || recording || uploading) return;

    // 检测浏览器支持的格式
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(audioStreamRef.current, { mimeType })
        : new MediaRecorder(audioStreamRef.current);
    } catch (err: any) {
      alert("无法启动录音，请检查麦克风权限: " + (err.message ?? ""));
      return;
    }

    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = () => {
      alert("录音过程中出错，请重试");
      setRecording(false);
    };

    recorder.onstop = async () => {
      if (chunksRef.current.length === 0) return;
      setUploading(true);
      try {
        // 使用 recorder.mimeType 或回退到 'audio/webm'
        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const form = new FormData();
        form.append("file", blob, `turn-${Date.now()}.${ext}`);
        const uploadRes = await fetch(`${BASE_URL}/api/upload/audio`, {
          method: "POST", body: form,
        });
        if (!uploadRes.ok) throw new Error(`${uploadRes.status}`);
        const { audio_url } = await uploadRes.json() as { audio_url: string };

        const userTurn: ConversationTurn = { role: "user", audio_url };
        const newHistory = [...history, userTurn];
        setHistory(newHistory);
        setSubtitle("你说了一句话...");

        await callChatTurn(audio_url, newHistory);
      } catch (err: any) {
        console.error("录音处理失败:", err);
      } finally {
        setUploading(false);
      }
    };

    recorder.start();
    setPressing(true);
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
  }, [recording, uploading, history]);

  // 停止录音
  const endRecord = useCallback(() => {
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!recording) return;
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [recording]);

  // ---- 调用 /api/chat/turn ----
  const callChatTurn = async (audio_url: string, currentHistory: ConversationTurn[]) => {
    setAiSpeaking(true);
    try {
      const res = await fetch(`${BASE_URL}/api/chat/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: (task as any)?.id ?? 0,
          audio_url,
          conversation_history: currentHistory,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { ai_text: string; ai_audio_url?: string };
        const aiTurn: ConversationTurn = { role: "ai", text: data.ai_text, audio_url: data.ai_audio_url };
        setHistory((prev) => [...prev, aiTurn]);
        setSubtitle(data.ai_text);

        // 自动播放 AI 语音
        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/")
            ? `${BASE_URL}${data.ai_audio_url}`
            : data.ai_audio_url;
          const audio = new Audio(fullUrl);
          audio.play().catch(() => {});
          audio.onended = () => setAiSpeaking(false);
        } else {
          // 无音频时延迟关掉动画
          setTimeout(() => setAiSpeaking(false), 2000);
        }
      } else {
        throw new Error(`${res.status}`);
      }
    } catch {
      // 降级：使用本地 Mock 回复
      const mockText = getAiReply(task);
      const aiTurn: ConversationTurn = { role: "ai", text: mockText };
      setHistory((prev) => [...prev, aiTurn]);
      setSubtitle(mockText);
      setTimeout(() => setAiSpeaking(false), 2000);
    }
  };

  // ---- 空格键长按 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && document.activeElement === document.body) {
        e.preventDefault();
        pressTimerRef.current = setTimeout(() => beginRecord(), 150);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        endRecord();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [beginRecord, endRecord]);

  // 清理
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ---- 提交诊断 ----
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (history.length < 2) { alert("请至少进行一轮对话"); return; }
    setSubmitting(true);
    try {
      const body = {
        task_id: (task as any)?.id ?? 0,
        conversation: history.map((h) => ({
          role: h.role,
          type: h.audio_url ? "audio" : "text",
          content: h.text ?? "",
          audio_url: h.audio_url ?? null,
        })),
        attempt_number: 1,
      };
      const res = await fetch(`${BASE_URL}/api/attempt1/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      localStorage.setItem("diagnosis", JSON.stringify(data));
      router.push("/diagnosis");
    } catch (err: any) {
      alert("提交失败: " + (err.message ?? ""));
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const { user, ai } = task ? parseRoles(task.roles) : { user: "", ai: "" };

  // ---- 空状态 ----
  if (!task) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold">初次产出</h1>
          <p className="mt-2 text-sm text-muted-foreground">请先选择场景生成任务</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/scenario")}>
            返回场景驱动
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="flex h-[calc(100vh-100px)] flex-col">
      {/* ---- 顶部任务摘要 ---- */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">
              {task.scene_label}
            </span>
            <span className="text-muted-foreground">
              {user.split("——")[0]} × {ai.split("——")[0]}
            </span>
          </div>
          <span className="hidden sm:inline text-muted-foreground">
            {task.goal?.slice(0, 50)}...
          </span>
        </div>
      </div>

      {/* ---- 主区域：左右两栏 ---- */}
      <div className="flex flex-1 min-h-0">
        {/* 左栏：用户摄像头 */}
        <div className="relative flex-1 border-r border-border bg-black">
          {cameraReady ? (
            <video
              ref={videoRef}
              autoPlay playsInline muted
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              摄像头未就绪
            </div>
          )}
          {/* 用户标签 + 录音指示 */}
          <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1 text-xs text-white backdrop-blur">
            {user.split("——")[0]}
            {recording && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                {formatTime(elapsed)}
              </span>
            )}
            {uploading && <span className="text-white/60">上传中...</span>}
          </div>
        </div>

        {/* 右栏：AI 头像 */}
        <div className="relative flex-1 bg-card">
          <div className="flex h-full flex-col items-center justify-center gap-6">
            {/* AI 头像 + 声波动画 */}
            <div className="relative">
              <div className="flex size-32 items-center justify-center rounded-full bg-linear-to-br from-primary/20 to-primary/5 ring-4 ring-border">
                <svg
                  className="size-16 text-primary"
                  viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="9" cy="10" r="1.5" />
                  <circle cx="15" cy="10" r="1.5" />
                  <path d="M9 15c.83.67 1.83 1 3 1s2.17-.33 3-1" />
                </svg>
              </div>

              {/* 声波动画 — AI 说话时激活 */}
              {aiSpeaking && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/30" />
                  <span className="absolute -inset-3 animate-ping rounded-full border border-primary/20 [animation-delay:300ms]" />
                  <span className="absolute -inset-6 animate-ping rounded-full border border-primary/10 [animation-delay:600ms]" />
                </>
              )}
            </div>

            {/* AI 名称 + 状态 */}
            <div className="text-center">
              <p className="text-sm font-semibold text-card-foreground">
                {ai.split("——")[0]}
              </p>
              <p className={`text-xs ${aiSpeaking ? "text-primary animate-pulse" : "text-muted-foreground"}`}>
                {aiSpeaking ? "正在说话..." : recording ? "正在听..." : "等待中"}
              </p>
            </div>

            {/* 字幕区 — 显示当前 AI/用户说的话 */}
            <div className="max-w-[90%] rounded-xl bg-muted/50 px-4 py-2.5 text-center">
              <p className="text-xs text-muted-foreground">
                {subtitle || "按住下方按钮或空格键开始对话"}
              </p>
            </div>

            {/* 对话轮次计数 */}
            <p className="text-xs text-muted-foreground/60">
              已对话 {history.length} 轮
            </p>
          </div>
        </div>
      </div>

      {/* ---- 底部控制栏 ---- */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          {/* 按住说话按钮 */}
          <button
            ref={holdBtnRef}
            onMouseDown={() => { pressTimerRef.current = setTimeout(() => beginRecord(), 150); }}
            onMouseUp={endRecord}
            onMouseLeave={endRecord}
            onTouchStart={(e) => { e.preventDefault(); pressTimerRef.current = setTimeout(() => beginRecord(), 150); }}
            onTouchEnd={(e) => { e.preventDefault(); endRecord(); }}
            disabled={uploading || !cameraReady}
            className={`
              shrink-0 select-none rounded-full px-8 py-3 text-sm font-semibold transition-all duration-150
              active:scale-95 touch-none
              ${recording
                ? "bg-destructive text-destructive-foreground shadow-lg scale-105"
                : uploading
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:bg-primary/90"
              }
            `}
          >
            {recording
              ? `松开停止 (${formatTime(elapsed)})`
              : uploading
                ? "处理中..."
                : "按住说话"}
          </button>

          <span className="hidden sm:inline text-xs text-muted-foreground">
            或按空格键
          </span>

          <div className="flex-1" />

          {/* 提交诊断 */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleSubmit}
            disabled={submitting || history.length < 2}
          >
            {submitting ? "提交中..." : "提交诊断"}
          </Button>
        </div>
      </div>
    </div>
  );
}
