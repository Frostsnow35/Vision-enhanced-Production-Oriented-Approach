"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BASE_URL, chatStart, chatTurn, type TurnFeedback } from "@/lib/api";
import RecordingWaveform from "@/components/RecordingWaveform";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";

/* ============================================================
   类型定义
   ============================================================ */
interface TaskData {
  scene_label: string;
  roles: string;
  goal: string;
  variant_plot?: string;
  evaluation_criteria?: string;
}

interface ConversationTurn {
  role: "user" | "ai";
  audio_url?: string;
  text?: string;
  turn_feedback?: TurnFeedback;
  feedback_collapsed?: boolean;
}

function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  return {
    user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || "未指定",
    ai: parts[1]?.trim() || "未指定",
  };
}

function getAiReply(task: TaskData | null): string {
  const generic = [
    "Sure, what would you like?",
    "Anything else I can help you with?",
    "Let me check that for you.",
    "That'll be $5.50, please.",
    "Would you like anything to drink with that?",
    "Sorry, could you repeat that?",
  ];
  const label = (task?.scene_label ?? "") + (task?.roles ?? "") + (task?.variant_plot ?? "");
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
  if (/做错|退换|mistake|wrong/i.test(label)) {
    specific.push("I'm sorry about that. Let me fix it right away.", "My apologies. Would you like a refund or a replacement?");
  } else if (/优惠|折扣|discount|sale/i.test(label)) {
    specific.push("We have a 20% discount on that today.", "Would you like to join our loyalty program?");
  } else if (/超重|升级|upgrade/i.test(label)) {
    specific.push("There's an additional fee for excess baggage.", "Would you like to upgrade to business class?");
  }
  const pool = specific.length > 0 ? [...specific, ...generic] : generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ============================================================
   页面组件
   ============================================================ */
export default function Attempt2Page() {
  const router = useRouter();

  // ---- 初始化状态 ----
  const [initDone, setInitDone] = useState(false);
  const [localTask, setLocalTask] = useState<TaskData | null>(null);
  const taskRef = useRef<TaskData | null>(null);
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("currentTask");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        taskRef.current = parsed;
        setLocalTask(parsed);
      } catch { /* ignore */ }
    }

    if (isTaskSelectedInSession() && taskRef.current) {
      setHasHistory(false);
      setInitDone(true);
      return;
    }

    const history = getScenarioHistory();
    setHasHistory(history.length > 0);
    setInitDone(true);
  }, []);

  const task = localTask;

  // ---- 摄像头 & 设备状态 ----
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"pending" | "ready" | "error">("pending");
  const [micStatus, setMicStatus] = useState<"pending" | "ready" | "error">("pending");
  const [micLevel, setMicLevel] = useState(0);
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!initDone) return;
    (async () => {
      // 摄像头
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        cameraStreamRef.current = camStream;
        if (videoRef.current) videoRef.current.srcObject = camStream;
        setCameraStatus("ready");
      } catch (err) {
        console.error("摄像头获取失败:", err);
        setCameraStatus("error");
      }
      // 麦克风
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStreamRef.current = audioStream;
        setMicStatus("ready");
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const source = ctx.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyserRef.current = analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setMicLevel(Math.min(avg / 255, 1));
          }
          requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch (err) {
        console.error("麦克风获取失败:", err);
        setMicStatus("error");
        if (cameraStreamRef.current) {
          audioStreamRef.current = cameraStreamRef.current;
          setMicStatus("ready");
        }
      }
    })();

    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current?.getTracks().forEach((t) => { if (t.kind === "audio") t.stop(); });
      audioContextRef.current?.close().catch(() => {});
    };
  }, [initDone]);

  const cameraReady = cameraStatus === "ready";
  const micReady = micStatus === "ready";

  // ---- 对话历史 ----
  const [history, setHistory] = useState<ConversationTurn[]>([]);

  // ---- AI 状态 ----
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const startedRef = useRef(false);
  const [isFinal, setIsFinal] = useState(false);

  // ---- 键盘提示自动消失 ----
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    if (cameraReady && showHint) {
      const timer = setTimeout(() => setShowHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [cameraReady, showHint]);

  // ---- 语音识别（Web Speech API）----
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const [speechSupported] = useState(() => {
    return typeof window !== "undefined" && !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);
  });
  const [interimTranscript, setInterimTranscript] = useState("");
  const finalTranscriptRef = useRef("");

  // ---- 页面加载时自动请求 AI 变体开场白 ----
  useEffect(() => {
    if (!initDone || !task || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setAiSpeaking(true);
      try {
        const res = await fetch(`${BASE_URL}/api/chat/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: (task as any)?.id ?? 0,
            is_variant: true,
            variant_context: task.variant_plot ?? "",
            scene_label: task.scene_label,
            roles: task.roles,
            goal: task.goal,
            evaluation_criteria: task.evaluation_criteria || "",
          }),
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
        const variantContext = task.variant_plot ?? "";
        const mockText = variantContext.includes("做错")
          ? "I'm sorry, but I think there might be a mistake with my order. Could you check this for me?"
          : variantContext.includes("优惠")
            ? "Welcome back! Today we have a special promotion. How can I help you?"
            : variantContext.includes("超重") || variantContext.includes("超售")
              ? "I'm sorry, but we have a situation with your booking. Let me explain..."
              : `Let's continue our conversation. ${getAiReply(task)}`;
        setSubtitle(mockText);
        setHistory([{ role: "ai", text: mockText }]);
        setTimeout(() => setAiSpeaking(false), 2500);
      }
    })();
  }, [task, initDone]);

  // ---- 语音录制 ----
  const [pressing, setPressing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdBtnRef = useRef<HTMLButtonElement>(null);

  const beginRecord = useCallback(() => {
    if (!audioStreamRef.current || recording || uploading) return;

    // --- MediaRecorder ---
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

      let audioUrl = "";
      try {
        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const form = new FormData();
        form.append("file", blob, `turn-${Date.now()}.${ext}`);
        const uploadRes = await fetch(`${BASE_URL}/api/upload/audio`, {
          method: "POST", body: form,
        });
        if (uploadRes.ok) {
          const data = await uploadRes.json() as { audio_url: string };
          audioUrl = data.audio_url;
        }
      } catch { /* ignore */ }

      const userText = finalTranscriptRef.current.trim();
      const userTurn: ConversationTurn = {
        role: "user",
        text: userText || undefined,
        audio_url: audioUrl || undefined,
      };
      const newHistory = [...history, userTurn];
      setHistory(newHistory);

      if (userText) {
        setSubtitle(`你说：${userText}`);
      }

      await callChatTurn(audioUrl, userText, newHistory);
      setUploading(false);
    };

    recorder.start();
    setPressing(true);
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);

    // --- Speech Recognition ---
    finalTranscriptRef.current = "";
    setInterimTranscript("");
    setSubtitle("正在听你说话...");

    if (speechSupported) {
      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) {
            finalTranscriptRef.current += (finalTranscriptRef.current ? " " : "") + r[0].transcript.trim();
          } else {
            interim += r[0].transcript;
          }
        }
        setInterimTranscript(interim);

        const display = finalTranscriptRef.current +
          (interim ? (finalTranscriptRef.current ? " " : "") + interim : "");
        setSubtitle(display || "正在听你说话...");
      };

      recognition.onerror = (e: Event) => {
        console.warn("语音识别错误:", (e as any).error);
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    }
  }, [recording, uploading, history, speechSupported]);

  const endRecord = useCallback(() => {
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!recording) return;

    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;

    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [recording]);

  const callChatTurn = async (audio_url: string, user_text: string, currentHistory: ConversationTurn[]) => {
    const currentTask = taskRef.current;
    if (isFinal) return;
    setAiSpeaking(true);
    setSubtitle("AI 正在思考...");
    try {
      const body: Record<string, unknown> = {
        task_id: (currentTask as any)?.id ?? 0,
        conversation_history: currentHistory,
        scene_label: currentTask?.scene_label || "",
        roles: currentTask?.roles || "",
        goal: currentTask?.goal || "",
        evaluation_criteria: currentTask?.evaluation_criteria || "",
      };
      if (user_text) {
        body.user_text = user_text;
      } else {
        body.audio_url = audio_url;
      }

      const res = await fetch(`${BASE_URL}/api/chat/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { ai_text: string; ai_audio_url?: string; is_final?: boolean; turn_feedback?: TurnFeedback };
        const aiTurn: ConversationTurn = {
          role: "ai",
          text: data.ai_text,
          audio_url: data.ai_audio_url,
          turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
          feedback_collapsed: false,
        };
        setHistory((prev) => [...prev, aiTurn]);
        setSubtitle(data.ai_text);

        if (data.is_final) {
          setIsFinal(true);
        }

        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/")
            ? `${BASE_URL}${data.ai_audio_url}`
            : data.ai_audio_url;
          const audio = new Audio(fullUrl);
          audio.play().catch(() => {});
          audio.onended = () => setAiSpeaking(false);
        } else {
          setTimeout(() => setAiSpeaking(false), 2000);
        }
      } else {
        throw new Error(`${res.status}`);
      }
    } catch {
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

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ---- 提交二次产出 ----
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
        attempt_number: 2,
      };
      // 收集用户录音的 audio_url，供后续评价页进行发音分析
      const audioUrls = history.filter(h => h.role === "user" && h.audio_url).map(h => h.audio_url);
      if (audioUrls.length > 0) {
        localStorage.setItem("attempt2_audio_urls", JSON.stringify(audioUrls));
      }
      const res = await fetch(`${BASE_URL}/api/attempt2/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      localStorage.setItem("diagnosis2", JSON.stringify(data));
      router.push("/evaluate");
    } catch (err: any) {
      alert("提交失败: " + (err.message ?? ""));
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const { user, ai } = task ? parseRoles(task.roles) : { user: "", ai: "" };

  // ---- 加载中 ----
  if (!initDone) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // ---- 空状态：有历史任务 → 显示选择器 ----
  if (hasHistory) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="w-full max-w-md px-4">
          <HistoryTaskSelector
            onSelected={(item: ScenarioHistoryItem) => {
              markTaskSelectedInSession();
              const taskData: TaskData = {
                scene_label: item.sceneLabel,
                roles: item.roles,
                goal: item.goal,
                variant_plot: item.task?.variant_plot,
                evaluation_criteria: item.task?.evaluation_criteria,
              };
              localStorage.setItem("currentTask", JSON.stringify(taskData));
              taskRef.current = taskData;
              setLocalTask(taskData);
              setHasHistory(false);
            }}
          />
        </div>
      </div>
    );
  }

  // ---- 无历史任务且无 currentTask ----
  if (!task) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold">二次产出</h1>
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
      {/* ---- 顶部：新情境任务 ---- */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">
              {task.scene_label}
            </span>
            <span className="text-muted-foreground">
              {user.split("——")[0]} × {ai.split("——")[0]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDevicePanel(!showDevicePanel)} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 hover:bg-muted transition-colors">
              <span className={`size-2 rounded-full ${cameraReady ? "bg-green-500" : "bg-red-500"}`} title="摄像头" />
              <span className={`size-2 rounded-full ${micReady ? "bg-green-500" : "bg-red-500"}`} title="麦克风" />
              <span className="text-muted-foreground">设备</span>
            </button>
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              二次产出
            </span>
          </div>
        </div>
        {showDevicePanel && (
          <div className="rounded-md bg-muted/30 px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${cameraStatus === "ready" ? "bg-green-500" : cameraStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
                <span>摄像头: {cameraStatus === "ready" ? "正常" : cameraStatus === "error" ? "失败" : "初始化中"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${micStatus === "ready" ? "bg-green-500" : micStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
                <span>麦克风: {micStatus === "ready" ? "正常" : micStatus === "error" ? "失败" : "初始化中"}</span>
              </div>
            </div>
            {micReady && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">音量:</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-green-500 transition-all duration-100" style={{ width: `${micLevel * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-9 text-right">{Math.round(micLevel * 100)}%</span>
              </div>
            )}
          </div>
        )}
        {task.variant_plot && (
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 text-[10px] text-amber-600 dark:text-amber-400">◆</span>
            <p className="text-xs leading-relaxed text-card-foreground">
              <span className="font-medium text-amber-600 dark:text-amber-400">新情境任务：</span>
              {task.variant_plot}
            </p>
          </div>
        )}
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
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              摄像头未就绪
            </div>
          )}
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
              {aiSpeaking && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/30" />
                  <span className="absolute -inset-3 animate-ping rounded-full border border-primary/20 [animation-delay:300ms]" />
                  <span className="absolute -inset-6 animate-ping rounded-full border border-primary/10 [animation-delay:600ms]" />
                </>
              )}
            </div>

            <div className="text-center">
              <p className="text-sm font-semibold text-card-foreground">
                {ai.split("——")[0]}
              </p>
              <p className={`text-xs ${aiSpeaking ? "text-primary animate-pulse" : "text-muted-foreground"}`}>
                {aiSpeaking ? "正在说话..." : recording ? "正在听..." : "等待中"}
              </p>
            </div>

            {/* 字幕区 — 实时转写 + AI 回复 */}
            <div className="max-w-[90%] rounded-xl bg-muted/50 px-4 py-2.5 text-center min-h-[3rem] flex items-center justify-center">
              {recording && interimTranscript ? (
                <p className="text-xs">
                  <span className="text-card-foreground">{subtitle.replace(interimTranscript, "").trim()}</span>
                  {" "}
                  <span className="italic text-muted-foreground/70">{interimTranscript}</span>
                </p>
              ) : (
                <p className={`text-xs ${aiSpeaking ? "text-card-foreground" : "text-muted-foreground"}`}>
                  {subtitle || "按住下方按钮或空格键开始对话"}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground/60">
              已对话 {history.length} 轮
            </p>
            {(() => {
              const lastFb = [...history].reverse().find((h) => h.role === "ai" && h.turn_feedback);
              if (!lastFb || !lastFb.turn_feedback) return null;
              const fb = lastFb.turn_feedback;
              const collapsed = !!lastFb.feedback_collapsed;
              const colorMap: Record<string, string> = {
                "发音标准度": "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                "语法规范性": "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                "词汇适配性": "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
                "语言功能达成度": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                "语用策略得体性": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                "话语回适合配性": "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
                "副语言匹配度": "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
              };
              return (
                <div className="max-w-[90%] w-full rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 mt-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex flex-wrap gap-1">
                      {fb.dimensions.length > 0 ? fb.dimensions.map((d) => (
                        <span key={d} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colorMap[d] || "bg-muted text-muted-foreground"}`}>{d}</span>
                      )) : <span className="text-[10px] text-muted-foreground">本轮反馈</span>}
                    </div>
                    <button
                      onClick={() => setHistory((prev) => prev.map((h, i) => i === prev.findLastIndex((x) => x === lastFb) ? { ...h, feedback_collapsed: !collapsed } : h))}
                      className="text-muted-foreground/60 hover:text-muted-foreground transition-colors text-xs"
                      title={collapsed ? "展开" : "折叠"}
                    >
                      {collapsed ? "▼" : "▲"}
                    </button>
                  </div>
                  {!collapsed && <p className="text-xs text-card-foreground/80 leading-relaxed">{fb.short_comment}</p>}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ---- 底部控制栏 ---- */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-2">
        {/* 波形图 */}
        <RecordingWaveform stream={audioStreamRef.current} isRecording={recording} />

        {isFinal && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-4 py-2.5 text-center">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">对话已完成，可以查看评价了</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            ref={holdBtnRef}
            onMouseDown={() => { pressTimerRef.current = setTimeout(() => beginRecord(), 150); }}
            onMouseUp={endRecord}
            onMouseLeave={endRecord}
            onTouchStart={(e) => { e.preventDefault(); pressTimerRef.current = setTimeout(() => beginRecord(), 150); }}
            onTouchEnd={(e) => { e.preventDefault(); endRecord(); }}
            disabled={!micReady || uploading || isFinal}
            className={`
              shrink-0 select-none rounded-full px-8 py-3 text-sm font-semibold transition-all duration-150
              active:scale-95 touch-none
              ${recording
                ? elapsed >= 28
                  ? "bg-destructive text-destructive-foreground shadow-lg scale-105 animate-pulse"
                  : elapsed >= 25
                    ? "bg-amber-500 text-white shadow-lg scale-105"
                    : "bg-destructive text-destructive-foreground shadow-lg scale-105"
                : !micReady
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : uploading || isFinal
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
              }
            `}
          >
            {!micReady
              ? "麦克风未就绪"
              : recording
                ? `松开停止 (${formatTime(elapsed)})`
                : uploading
                  ? "处理中..."
                  : isFinal
                    ? "对话已结束"
                    : "按住说话"}
          </button>

          <span className="hidden sm:inline text-xs text-muted-foreground">
            或按空格键
          </span>

          {!speechSupported && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              当前浏览器不支持实时转写，录音仍可用
            </span>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || history.length < 2}
          >
            {submitting ? "提交中..." : "完成二次产出，查看评价"}
          </Button>
        </div>
      </div>
    </div>
  );
}
