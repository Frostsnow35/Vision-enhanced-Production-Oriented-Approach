"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BASE_URL, chatStart, chatTurn, type TurnFeedback } from "@/lib/api";
import RecordingWaveform from "@/components/RecordingWaveform";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import { isDeviceCheckPassed } from "@/lib/device-check";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";

/* ============================================================
   类型
   ============================================================ */
interface TaskData {
  scene_label: string;
  roles: string;
  goal: string;
  evaluation_criteria?: string;
}

interface ConversationTurn {
  role: "user" | "ai";
  text?: string;
  audio_url?: string;
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

// AI 开场白
function getOpeningLine(task: TaskData): string {
  const label = task.scene_label + task.roles;
  if (/咖啡|cafe|coffee/i.test(label)) return "Hi there! What can I get for you today?";
  if (/图书馆|library/i.test(label)) return "Welcome to the library! How can I help you?";
  if (/餐厅|restaurant/i.test(label)) return "Good evening! Do you have a reservation?";
  if (/机场|airport/i.test(label)) return "Good morning! Where are you flying to today?";
  return "Hello! How can I help you today?";
}

// Mock AI 回复
function getAiReply(task: TaskData | null): string {
  const generic = ["Sure, what would you like?", "Anything else I can help you with?", "Let me check that for you."];
  const label = (task?.scene_label ?? "") + (task?.roles ?? "");
  const specific: string[] = [];
  if (/咖啡|cafe|coffee/i.test(label)) specific.push("What size — small, medium, or large?", "Hot or iced?");
  else if (/机场|airport/i.test(label)) specific.push("Window or aisle seat?", "Do you have any checked bags?");
  const pool = specific.length > 0 ? [...specific, ...generic] : generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ============================================================
   页面
   ============================================================ */
export default function Attempt1Page() {
  const router = useRouter();

  // ---- 初始化状态 ----
  const [initDone, setInitDone] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [localTask, setLocalTask] = useState<TaskData | null>(null);
  const taskRef = useRef<TaskData | null>(null);

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

  // ---- Refs ----
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // ---- 设备状态 ----
  const [micLevel, setMicLevel] = useState(0);
  const [micSpectrum, setMicSpectrum] = useState<number[]>(Array(12).fill(0));
  const [cameraStatus, setCameraStatus] = useState<"pending" | "ready" | "error">("pending");
  const [micStatus, setMicStatus] = useState<"pending" | "ready" | "error">("pending");
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [devicePassed, setDevicePassed] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    setDevicePassed(isDeviceCheckPassed());
  }, []);

  useEffect(() => {
    if (!initDone) return;
    (async () => {
      // 尝试获取摄像头
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        cameraStreamRef.current = camStream;
        if (videoRef.current) videoRef.current.srcObject = camStream;
        setCameraStatus("ready");
      } catch (err) {
        console.error("摄像头获取失败:", err);
        setCameraStatus("error");
      }

      // 尝试获取麦克风
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStreamRef.current = audioStream;
        setMicStatus("ready");
        
        // 设置麦克风监听
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const source = ctx.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyserRef.current = analyser;

        const timeData = new Uint8Array(analyser.fftSize);
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const BARS = 12;
        const smoothedBars = Array(BARS).fill(0);
        const updateLevel = () => {
          if (analyserRef.current) {
            // 时域 RMS（对人声敏感；旧的频域平均对低频不灵敏）
            analyserRef.current.getByteTimeDomainData(timeData);
            let sumSquares = 0;
            for (let i = 0; i < timeData.length; i++) {
              const v = (timeData[i] - 128) / 128;
              sumSquares += v * v;
            }
            const rms = Math.sqrt(sumSquares / timeData.length);
            const boosted = Math.min(rms * 2.5, 1);
            setMicLevel((prev) => prev * 0.4 + boosted * 0.6);

            // 频谱：把频域按 BARS 段分桶
            analyserRef.current.getByteFrequencyData(freqData);
            const binCount = freqData.length;
            const buckets: number[] = [];
            for (let b = 0; b < BARS; b++) {
              const start = Math.floor((binCount * b) / BARS);
              const end = Math.floor((binCount * (b + 1)) / BARS);
              let sum = 0;
              for (let i = start; i < end; i++) sum += freqData[i];
              const avg = sum / Math.max(1, end - start);
              buckets.push(avg / 255);
            }
            // 平滑
            for (let b = 0; b < BARS; b++) {
              smoothedBars[b] = smoothedBars[b] * 0.5 + buckets[b] * 0.5;
            }
            setMicSpectrum([...smoothedBars]);
          }
          requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch (err) {
        console.error("麦克风获取失败:", err);
        setMicStatus("error");
        // 如果单独获取麦克风失败，尝试从摄像头流获取音频
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
    if (cameraStatus === "ready" && showHint) {
      const timer = setTimeout(() => setShowHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [cameraStatus, showHint]);

  // ---- 语音识别 ----
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const [speechSupported] = useState(() => typeof window !== "undefined" && !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition));
  const [interimTranscript, setInterimTranscript] = useState("");
  const finalTranscriptRef = useRef("");

  // ---- AI 开场白 ----
  useEffect(() => {
    if (!initDone || !task || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setAiSpeaking(true);
      try {
        const data = await chatStart(
          task.scene_label,
          task.roles,
          task.goal,
          task.evaluation_criteria
        );
        setSubtitle(data.ai_text);
        setHistory([{ role: "ai", text: data.ai_text, audio_url: data.ai_audio_url }]);
        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/") ? `${BASE_URL}${data.ai_audio_url}` : data.ai_audio_url;
          const audio = new Audio(fullUrl);
          audio.play().catch((e) => console.error("AI 语音播放失败:", e));
          audio.onended = () => setAiSpeaking(false);
        } else {
          setTimeout(() => setAiSpeaking(false), 2500);
        }
      } catch {
        const mockText = getOpeningLine(task);
        setSubtitle(mockText);
        setHistory([{ role: "ai", text: mockText }]);
        setTimeout(() => setAiSpeaking(false), 2500);
      }
    })();
  }, [task, initDone]);

  // ---- 录音 ----
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 通话轮次 ----
  const callChatTurn = async (audio_url: string, user_text: string, currentHistory: ConversationTurn[]) => {
    const currentTask = taskRef.current;
    if (isFinal) return;
    setAiSpeaking(true);
    setSubtitle("AI 正在思考...");
    try {
      const data = await chatTurn(
        user_text,
        audio_url,
        currentHistory,
        currentTask?.scene_label || "",
        currentTask?.roles || "",
        currentTask?.goal,
        currentTask?.evaluation_criteria
      );
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
        const fullUrl = data.ai_audio_url.startsWith("/") ? `${BASE_URL}${data.ai_audio_url}` : data.ai_audio_url;
        const audio = new Audio(fullUrl);
        audio.play().catch((e) => console.error("AI 语音播放失败:", e));
        audio.onended = () => setAiSpeaking(false);
      } else { setTimeout(() => setAiSpeaking(false), 2000); }
    } catch {
      const mockText = getAiReply(task);
      const aiTurn: ConversationTurn = { role: "ai", text: mockText };
      setHistory((prev) => [...prev, aiTurn]);
      setSubtitle(mockText);
      setTimeout(() => setAiSpeaking(false), 2000);
    }
  };

  const beginRecord = useCallback(() => {
    if (!audioStreamRef.current || recording || uploading) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(audioStreamRef.current, { mimeType }) : new MediaRecorder(audioStreamRef.current);
    } catch (err: unknown) { alert("无法启动录音: " + ((err as Error)?.message ?? "")); return; }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onerror = () => { alert("录音出错"); setRecording(false); };
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
        const uploadRes = await fetch(`${BASE_URL}/api/upload/audio`, { method: "POST", body: form });
        if (uploadRes.ok) { const data = await uploadRes.json() as { audio_url: string }; audioUrl = data.audio_url; }
      } catch { /* ignore */ }
      const userText = finalTranscriptRef.current.trim();
      const userTurn: ConversationTurn = { role: "user", text: userText || undefined, audio_url: audioUrl || undefined };
      const newHistory = [...history, userTurn];
      setHistory(newHistory);
      if (userText) setSubtitle(`你说：${userText}`);
      await callChatTurn(audioUrl, userText, newHistory);
      setUploading(false);
    };
    recorder.start();
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    finalTranscriptRef.current = "";
    setInterimTranscript("");
    setSubtitle("正在听你说话...");
    if (speechSupported) {
      const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalTranscriptRef.current += (finalTranscriptRef.current ? " " : "") + r[0].transcript.trim();
          else interim += r[0].transcript;
        }
        setInterimTranscript(interim);
        const display = finalTranscriptRef.current + (interim ? (finalTranscriptRef.current ? " " : "") + interim : "");
        setSubtitle(display || "正在听你说话...");
      };
      recognition.onerror = (e: Event) => console.warn("语音识别错误:", (e as unknown as { error: string }).error);
      recognition.start();
      speechRecognitionRef.current = recognition;
    }
  }, [recording, uploading, history, speechSupported]);

  const endRecord = useCallback(() => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    if (!recording) return;
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [recording]);

  // ---- 空格键 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space" && !e.repeat && document.activeElement === document.body) { e.preventDefault(); pressTimerRef.current = setTimeout(() => beginRecord(), 150); } };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); endRecord(); } };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [beginRecord, endRecord]);

  useEffect(() => { return () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  // ---- 提交诊断 ----
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (history.length < 2) { alert("请至少进行一轮对话"); return; }
    setSubmitting(true);
    try {
      const conversationText = history.map((h) => h.text || "").filter(Boolean).join("\n");
      // 收集用户录音的 audio_url，供后续评价页进行发音分析
      const audioUrls = history.filter(h => h.role === "user" && h.audio_url).map(h => h.audio_url);
      if (audioUrls.length > 0) {
        localStorage.setItem("attempt1_audio_urls", JSON.stringify(audioUrls));
      }
      const res = await fetch(`${BASE_URL}/api/attempt1/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attempt_text: conversationText || "[no speech]", attempt_number: 1 }) });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      localStorage.setItem("diagnosis", JSON.stringify(data));
      router.push("/diagnosis");
    } catch (err: any) { alert("提交失败: " + (err.message ?? "")); } finally { setSubmitting(false); }
  };

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const { user, ai } = task ? parseRoles(task.roles) : { user: "", ai: "" };

  // ---- 加载中 ----
  if (!initDone) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="text-center text-muted-foreground">加载中...</div></div>;
  }

  // ---- 有历史任务 ----
  if (hasHistory) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="w-full max-w-md px-4"><HistoryTaskSelector onSelected={(item: ScenarioHistoryItem) => { markTaskSelectedInSession(); const taskData: TaskData = { scene_label: item.sceneLabel, roles: item.roles, goal: item.goal, evaluation_criteria: item.task?.evaluation_criteria }; localStorage.setItem("currentTask", JSON.stringify(taskData)); taskRef.current = taskData; setLocalTask(taskData); setHasHistory(false); }} /></div></div>;
  }

  // ---- 无任务 ----
  if (!task) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="text-center"><h1 className="text-xl font-bold">初次产出</h1><p className="mt-2 text-sm text-muted-foreground">请先选择场景生成任务</p><Button className="mt-4" variant="outline" onClick={() => router.push("/scenario")}>返回场景驱动</Button></div></div>;
  }

  /* ============================================================
     Render
     ============================================================ */
  const cameraReady = cameraStatus === "ready";
  const micReady = micStatus === "ready";
  const canRecord = micReady && !uploading && !isFinal;
  const recordDisabledReason = !devicePassed
    ? "请先完成设备检测"
    : !micReady
    ? "麦克风未就绪"
    : uploading
    ? "正在上传"
    : isFinal
    ? "对话已结束"
    : "";

  return (
    <div className="flex h-[calc(100vh-100px)] flex-col">
      {/* 顶部任务摘要 */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">{task.scene_label}</span>
            <span className="text-muted-foreground">{user.split("——")[0]} × {ai.split("——")[0]}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* 设备检测独立页入口 */}
            <button
              onClick={() => router.push("/device-check")}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
                devicePassed
                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  : "bg-rose-100 text-rose-700 hover:bg-rose-200"
              }`}
              title={devicePassed ? "设备检测已通过" : "点击进行设备检测"}
            >
              <span className={`size-2 rounded-full ${devicePassed ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span>🎛 {devicePassed ? "设备就绪" : "设备检测"}</span>
            </button>
            {/* 设备状态指示器 */}
            <button onClick={() => setShowDevicePanel(!showDevicePanel)} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 hover:bg-muted transition-colors">
              <span className={`size-2 rounded-full ${cameraReady ? "bg-green-500" : "bg-red-500"}`} title="摄像头" />
              <span className={`size-2 rounded-full ${micReady ? "bg-green-500" : "bg-red-500"}`} title="麦克风" />
              <span className="text-muted-foreground">调试</span>
            </button>
          </div>
        </div>
      </div>

      {/* 设备调试面板 */}
      {showDevicePanel && (
        <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${cameraStatus === "ready" ? "bg-green-500" : cameraStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
              <span className="text-xs">摄像头: {cameraStatus === "ready" ? "正常" : cameraStatus === "error" ? "失败" : "初始化中"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${micStatus === "ready" ? "bg-green-500" : micStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
              <span className="text-xs">麦克风: {micStatus === "ready" ? "正常" : micStatus === "error" ? "失败" : "初始化中"}</span>
            </div>
          </div>
          {micReady && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">麦克风音量:</span>
              <div className="flex-1 h-6 flex items-end gap-0.5">
                {micSpectrum.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all duration-75"
                    style={{
                      height: `${Math.max(4, v * 100)}%`,
                      backgroundColor: v > 0.7 ? "#22c55e" : v > 0.4 ? "#84cc16" : "#3b82f6",
                    }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground w-9 text-right">{Math.round(micLevel * 100)}%</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground/60">点击空白处或再次点击&quot;设备&quot;关闭此面板</p>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 border-r border-border bg-black">
          {cameraReady ? <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" /> : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span>摄像头未就绪</span>
              {cameraStatus === "error" && <span className="text-xs text-amber-500">请允许浏览器访问摄像头</span>}
            </div>
          )}
          <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1 text-xs text-white backdrop-blur">
            {user.split("——")[0]}
            {recording && <span className="flex items-center gap-1"><span className="size-1.5 animate-pulse rounded-full bg-red-500" />{formatTime(elapsed)}</span>}
            {uploading && <span className="text-white/60">处理中...</span>}
          </div>
        </div>

        {/* AI 头像 */}
        <div className="relative flex-1 bg-card">
          <div className="flex h-full flex-col items-center justify-center gap-6">
            <div className="relative">
              <div className="flex size-32 items-center justify-center rounded-full bg-linear-to-br from-primary/20 to-primary/5 ring-4 ring-border">
                <svg className="size-16 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" /><path d="M9 15c.83.67 1.83 1 3 1s2.17-.33 3-1" /></svg>
              </div>
              {aiSpeaking && <><span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/30" /><span className="absolute -inset-3 animate-ping rounded-full border border-primary/20 [animation-delay:300ms]" /><span className="absolute -inset-6 animate-ping rounded-full border border-primary/10 [animation-delay:600ms]" /></>}
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-card-foreground">{ai.split("——")[0]}</p>
              <p className={`text-xs ${aiSpeaking ? "text-primary animate-pulse" : "text-muted-foreground"}`}>{aiSpeaking ? "正在说话..." : recording ? "正在听..." : "等待中"}</p>
            </div>
            <div className="max-w-[90%] rounded-xl bg-muted/50 px-4 py-2.5 text-center min-h-[3rem] flex items-center justify-center">
              {recording && interimTranscript ? <p className="text-xs"><span className="text-card-foreground">{subtitle.replace(interimTranscript, "").trim()}</span> <span className="italic text-muted-foreground/70">{interimTranscript}</span></p> : (
                <p className={`text-xs ${aiSpeaking ? "text-card-foreground" : "text-muted-foreground"}`}>
                  {subtitle ? <ClickableEnglish text={subtitle} /> : "按住下方按钮或空格键开始对话"}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground/60">已对话 {history.length} 轮</p>
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

      {/* 底部控制栏 */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-2">
        <RecordingWaveform stream={audioStreamRef.current} isRecording={recording} />
        {isFinal && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-4 py-2.5 text-center">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">对话已完成，可以提交诊断了</p>
          </div>
        )}
        {!canRecord && recordDisabledReason && (
          <p className="text-center text-xs text-rose-600">
            {recordDisabledReason}
            {!devicePassed && (
              <button onClick={() => router.push("/device-check")} className="ml-2 underline hover:text-rose-800">
                去检测
              </button>
            )}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onMouseDown={() => { if (canRecord) beginRecord(); }}
            onMouseUp={endRecord}
            onMouseLeave={endRecord}
            onTouchStart={(e) => { e.preventDefault(); if (canRecord) beginRecord(); }}
            onTouchEnd={(e) => { e.preventDefault(); endRecord(); }}
            disabled={!canRecord}
            title={recordDisabledReason || (recording ? "松开结束录音" : "按住说话")}
            className={`shrink-0 select-none rounded-full px-8 py-3 text-sm font-semibold transition-all duration-150 active:scale-95 touch-none ${
              recording
                ? elapsed >= 28
                  ? "bg-destructive text-destructive-foreground shadow-lg scale-105 animate-pulse"
                  : elapsed >= 25
                    ? "bg-amber-500 text-white shadow-lg scale-105"
                    : "bg-destructive text-destructive-foreground shadow-lg scale-105"
                : !micReady
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : uploading || isFinal
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:bg-primary/90"
            }`}>
            {!micReady ? "麦克风未就绪" : recording ? `松开停止 (${formatTime(elapsed)})` : uploading ? "处理中..." : isFinal ? "对话已结束" : "按住说话"}
          </button>
          {showHint && micReady && <span className="hidden sm:inline text-xs text-muted-foreground/60 animate-in fade-in duration-300">或长按空格键录音</span>}
          {!speechSupported && micReady && <span className="text-xs text-amber-600 dark:text-amber-400">当前浏览器不支持实时转写</span>}
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={handleSubmit} disabled={submitting || history.length < 2}>{submitting ? "提交中..." : "提交诊断"}</Button>
        </div>
      </div>
    </div>
  );
}
