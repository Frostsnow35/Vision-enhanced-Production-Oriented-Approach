"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/* ============================================================
   类型定义
   ============================================================ */
type Role = "user" | "ai";
type MessageType = "text" | "audio";

interface Message {
  role: Role;
  type: MessageType;
  content: string;
  audio_url?: string;
}

interface TaskData {
  scene_label: string;
  roles: string;
  goal: string;
  context_constraints: string;
  evaluation_criteria: string;
  variant_plot: string;
  id?: number;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "";

/* ============================================================
   工具函数
   ============================================================ */
function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  const partA = parts[0]?.replace(/^A[:：]\s*/i, "").trim() ?? raw;
  const partB = parts[1]?.trim() ?? "";
  return { user: partA || "未指定", ai: partB || "未指定" };
}

/** 根据场景生成 AI 开场白 */
function getOpeningLine(task: TaskData): string {
  const label = task.scene_label + task.roles;
  if (/咖啡|cafe|coffee/i.test(label)) {
    return "Hi there! What can I get for you today?";
  }
  if (/图书馆|library/i.test(label)) {
    return "Welcome to the library! How can I help you find what you need?";
  }
  if (/餐厅|restaurant|dining/i.test(label)) {
    return "Good evening! Do you have a reservation, or would you like to see the menu?";
  }
  if (/医院|hospital|clinic/i.test(label)) {
    return "Hello, how can I help you today? Do you have an appointment?";
  }
  if (/机场|airport|flight/i.test(label)) {
    return "Good morning! Where are you flying to today? May I see your passport, please?";
  }
  if (/商场|mall|shop|store/i.test(label)) {
    return "Hello! Welcome to our store. Is there anything specific you're looking for?";
  }
  return "Hello! How can I help you today?";
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
    } catch {
      // ignore
    }
  }, []);

  // ---- 对话历史（AI 开场白自动加入） ----
  const [conversation, setConversation] = useState<Message[]>([]);
  const openedRef = useRef(false);

  useEffect(() => {
    if (task && !openedRef.current) {
      openedRef.current = true;
      setConversation([
        {
          role: "ai",
          type: "text",
          content: getOpeningLine(task),
        },
      ]);
    }
  }, [task]);

  // ---- 输入模式 Tab ----
  const [tab, setTab] = useState<"text" | "voice">("text");

  // ---- 文本输入 ----
  const [textInput, setTextInput] = useState("");

  // ---- 语音录制 ----
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 提交诊断 ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // 滚动到底部
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  // ---- 发送文本 ----
  const sendText = useCallback(() => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    const msg: Message = { role: "user", type: "text", content: trimmed };
    setConversation((prev) => [...prev, msg]);
    setTextInput("");
  }, [textInput]);

  // ---- 开始录音 ----
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // 停止所有音轨
        stream.getTracks().forEach((t) => t.stop());

        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        });

        // 上传音频
        setUploading(true);
        try {
          const form = new FormData();
          form.append("file", blob, `recording-${Date.now()}.webm`);
          const res = await fetch(`${BASE_URL}/api/upload/audio`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          const { audio_url } = await res.json() as { audio_url: string };

          const msg: Message = {
            role: "user",
            type: "audio",
            content: "[语音消息]",
            audio_url,
          };
          setConversation((prev) => [...prev, msg]);
        } catch (err: any) {
          alert("音频上传失败: " + (err.message ?? String(err)));
        } finally {
          setUploading(false);
        }
      };

      recorder.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    } catch (err: any) {
      alert("无法访问麦克风: " + (err.message ?? String(err)));
    }
  };

  // ---- 停止录音 ----
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // ---- 格式化录音时长 ----
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ---- 提交诊断 ----
  const handleSubmit = async () => {
    if (conversation.length <= 1) {
      setSubmitError("请至少发送一条消息后再提交诊断");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    try {
      const body = {
        task_id: task?.id ?? 0,
        conversation,
        attempt_number: 1,
      };
      const res = await fetch(`${BASE_URL}/api/attempt1/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "Unknown");
        throw new Error(`${res.status}: ${detail}`);
      }
      const data = await res.json();
      localStorage.setItem("diagnosis", JSON.stringify(data));
      router.push("/facilitate");
    } catch (err: any) {
      setSubmitError(err.message ?? "请求失败，请确认后端已启动");
      alert("诊断提交失败: " + (err.message ?? String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 空状态 ----
  if (!task) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-card-foreground">
          初次产出
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          请先选择场景生成任务
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={() => router.push("/scenario")}
        >
          返回场景驱动
        </Button>
      </div>
    );
  }

  const { user, ai } = parseRoles(task.roles);

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={{ height: "calc(100vh - 120px)" }}>
      {/* ---- 顶部任务卡片 ---- */}
      <div className="shrink-0 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {task.scene_label}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">你的角色: </span>
            <span className="font-medium text-card-foreground">
              {user.split("——")[0]?.trim() ?? user}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">AI 角色: </span>
            <span className="font-medium text-card-foreground">
              {ai.split("——")[0]?.trim() ?? ai}
            </span>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          目标: {task.goal}
        </p>
      </div>

      {/* ---- 对话区 ---- */}
      <div className="my-4 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-sm">
        {conversation.map((msg, i) => (
          <ChatBubble key={i} message={msg} />
        ))}
        {uploading && (
          <div className="flex justify-end">
            <div className="max-w-[70%] rounded-2xl bg-primary/60 px-4 py-2 text-sm text-white">
              上传中...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ---- 输入区 ---- */}
      <div className="shrink-0 rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        {/* Tab 切换 */}
        <div className="flex gap-1">
          {(["text", "voice"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-card-foreground"
              }`}
            >
              {t === "text" ? "文本输入" : "语音输入"}
            </button>
          ))}
        </div>

        {/* 文本输入 */}
        {tab === "text" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendText();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="用英语输入你的对话..."
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            <Button type="submit" size="sm" disabled={!textInput.trim()}>
              发送
            </Button>
          </form>
        )}

        {/* 语音输入 */}
        {tab === "voice" && (
          <div className="flex items-center gap-3">
            {recording ? (
              <>
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="size-2 animate-pulse rounded-full bg-destructive" />
                  {formatTime(elapsed)}
                </span>
                <Button size="sm" variant="destructive" onClick={stopRecording}>
                  停止录音
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={startRecording}
                disabled={uploading}
              >
                开始录音
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ---- 提交诊断按钮 ---- */}
      <div className="shrink-0 mt-3 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-xs text-muted-foreground">
          对话完成后，点击提交获取诊断
        </p>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "提交中..." : "提交并查看诊断"}
        </Button>
      </div>
      {submitError && (
        <p className="mt-1 text-xs text-destructive">{submitError}</p>
      )}
    </div>
  );
}

/* ============================================================
   对话气泡
   ============================================================ */
function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-card-foreground rounded-bl-md"
        }`}
      >
        {/* 标签 */}
        <p className="mb-0.5 text-[10px] font-semibold opacity-60">
          {isUser ? "You" : "AI"}
        </p>

        {/* 内容 */}
        {message.type === "text" ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.audio_url ? (
          <div className="space-y-1">
            <p className="text-xs opacity-70">语音消息</p>
            <audio
              controls
              src={message.audio_url}
              className="h-7 w-full max-w-[260px]"
            />
          </div>
        ) : (
          <p className="text-xs opacity-50">语音处理中...</p>
        )}
      </div>
    </div>
  );
}
