"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BASE_URL, type TurnFeedback } from "@/lib/api";
import { playAiAudio, speakWithBrowserTTS } from "@/lib/audio";
import RecordingWaveform from "@/components/RecordingWaveform";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import { isDeviceCheckPassed } from "@/lib/device-check";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";
import DeviceCheckModal from "@/components/DeviceCheckModal";
import CountdownEffect from "@/components/CountdownEffect";
import TaskGate from "@/components/TaskGate";

/* ============================================================
   常量
   ============================================================ */
const ATTEMPT2_MAX_USER_TURNS = 4;
const MIN_USER_TURNS = 2;
const WRAP_UP_HINT = "[system: conversation reached the turn limit. Please wrap up with a natural, scene-specific farewell and append [CONVERSATION_COMPLETE].]";
const FALLBACK_CLOSING = "Thanks for chatting with me! Have a great day. [CONVERSATION_COMPLETE]";

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
  final_transcript?: string;
  interim_transcript?: string;
  sent_user_text?: string;
  resolved_user_text?: string;
  turn_feedback?: TurnFeedback;
  feedback_collapsed?: boolean;
  error?: boolean;  // 标记该轮为错误轮次，前端渲染红色警示
}

type SpeechProcessingStage =
  | "idle"
  | "recording"
  | "uploading"
  | "upload_complete"
  | "asr_processing"
  | "waiting_model_reply"
  | "ai_speaking"
  | "wrapping_up";

function getProcessingStageLabel(stage: SpeechProcessingStage): string {
  switch (stage) {
    case "recording":
      return "正在录音";
    case "uploading":
      return "上传中...";
    case "upload_complete":
      return "上传完成";
    case "asr_processing":
      return "ASR 处理中...";
    case "waiting_model_reply":
      return "等待模型回复...";
    case "ai_speaking":
      return "AI 正在说话...";
    case "wrapping_up":
      return "AI 正在收尾...";
    default:
      return "";
  }
}

function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  return {
    user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || "未指定",
    ai: parts[1]?.trim() || "未指定",
  };
}

interface LowQualityResult {
  isLowQuality: boolean;
  reason: string;
}

/**
 * 检测 AI 回复是否属于低质量回复（死胡同、连续反问、主题偏离）
 */
function detectLowQualityReply(
  aiText: string,
  prevAiText: string | undefined,
  variantPlot: string | undefined,
): LowQualityResult {
  // 规则1：死胡同检测
  const deadEndRe =
    /let me (go |)ask|i'?ll check with|i need to confirm|let me find out|i'?ll have to ask|i'?ll look into|let me see if|i have to check/i;
  if (deadEndRe.test(aiText)) {
    return {
      isLowQuality: true,
      reason: "AI 回复看起来像是要离开去查询，可能导致对话中断",
    };
  }

  // 规则2：连续反问不推进检测
  if (prevAiText) {
    const confirmationWords = [
      "sure",
      "great",
      "okay",
      "alright",
      "yes",
      "no",
      "got it",
      "i see",
      "of course",
      "absolutely",
      "sorry",
      "my apologies",
    ];
    const questionLeaders = [
      "what",
      "which",
      "would you",
      "could you",
      "can you",
      "do you",
      "did you",
      "have you",
      "are you",
      "is there",
      "how about",
      "shall we",
    ];

    const isPureQuestion = (text: string): boolean => {
      const cleaned = text
        .replace(/\?+$/, "")
        .trim()
        .toLowerCase();
      const hasConfirmation = confirmationWords.some((w) =>
        cleaned.includes(w),
      );
      if (hasConfirmation) return false;
      const endsWithQuestion = /\?\s*$/.test(text.trim());
      const hasQuestionLeader = questionLeaders.some((l) =>
        cleaned.startsWith(l),
      );
      return endsWithQuestion || hasQuestionLeader;
    };

    if (isPureQuestion(aiText) && isPureQuestion(prevAiText)) {
      return {
        isLowQuality: true,
        reason: "AI 连续两轮都在反问，没有推进对话",
      };
    }
  }

  // 规则3：主题偏离检测
  if (variantPlot && variantPlot.trim().length > 0) {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "shall",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "it",
      "its",
      "this",
      "that",
      "these",
      "those",
      "and",
      "or",
      "but",
      "not",
      "no",
      "if",
      "so",
      "as",
      "than",
      "then",
      "just",
      "also",
      "very",
      "too",
      "all",
      "some",
      "any",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "only",
      "own",
      "same",
      "into",
      "up",
      "out",
      "about",
      "over",
      "after",
      "before",
      "between",
      "under",
      "again",
      "further",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "which",
      "who",
      "whom",
      "whose",
      "what",
      "的",
      "了",
      "在",
      "是",
      "我",
      "有",
      "和",
      "就",
      "不",
      "人",
      "都",
      "一",
      "一个",
      "上",
      "也",
      "很",
      "到",
      "说",
      "要",
      "去",
      "你",
      "会",
      "着",
      "没有",
      "看",
      "好",
      "自己",
      "这",
      "他",
      "她",
      "它",
      "们",
      "那",
      "些",
      "什么",
      "怎么",
      "哪",
      "吗",
      "啊",
      "吧",
      "呢",
      "哦",
      "嗯",
      "哈",
      "呀",
      "还",
      "被",
      "把",
      "让",
      "向",
      "从",
      "对",
      "与",
      "或",
      "而",
      "但",
      "且",
      "因",
      "为",
      "所",
      "以",
      "能",
      "可",
      "将",
      "已",
      "并",
      "其",
    ]);

    const tokens = variantPlot
      .replace(/[.,!?;:，。！？；：\s]+/g, " ")
      .split(" ")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3 && !stopWords.has(t));

    if (tokens.length > 0) {
      const aiLower = aiText.toLowerCase();
      const hasOverlap = tokens.some((token) => aiLower.includes(token));
      if (!hasOverlap) {
        return {
          isLowQuality: true,
          reason: "AI 回复可能偏离了变体任务主题",
        };
      }
    }
  }

  return { isLowQuality: false, reason: "" };
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
  const [micSpectrum, setMicSpectrum] = useState<number[]>(Array(12).fill(0));
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [devicePassed, setDevicePassed] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // ---- 设备模态框（自动唤起）----
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  // ---- 3 秒倒计时 ----
  const [countdownKey, setCountdownKey] = useState<number | null>(null);
  // ---- 待显示的 AI 字幕（需手动点击才显示）----
  const [pendingAiSubtitle, setPendingAiSubtitle] = useState<string | null>(null);
  // ---- 已锁定的字幕 ----
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  // ---- 标记是否正在等待麦克风就绪 ----
  const [micReadyWait, setMicReadyWait] = useState(false);

  useEffect(() => {
    const passed = isDeviceCheckPassed();
    setDevicePassed(passed);
    // 未通过时自动唤起模态框
    if (!passed) setShowDeviceModal(true);
  }, []);

  // ---- 摄像头 & 麦克风 ----
  const initDevices = useCallback(async () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current?.getTracks().forEach((t) => { if (t.kind === "audio") t.stop(); });
    audioContextRef.current?.close().catch(() => {});
    setCameraStatus("pending");
    setMicStatus("pending");

    console.log("[CAM] 开始请求摄像头...");
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      cameraStreamRef.current = camStream;
      setCameraStatus("ready");
      console.log("[CAM] 摄像头就绪");
    } catch (err) {
      console.error("[CAM] 摄像头失败:", err);
      setCameraStatus("error");
    }
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
      const timeData = new Uint8Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const BARS = 12;
      const smoothedBars = Array(BARS).fill(0);
      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteTimeDomainData(timeData);
          let sumSquares = 0;
          for (let i = 0; i < timeData.length; i++) {
            const v = (timeData[i] - 128) / 128;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / timeData.length);
          const boosted = Math.min(rms * 2.5, 1);
          setMicLevel((prev) => prev * 0.4 + boosted * 0.6);
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
      if (cameraStreamRef.current) {
        audioStreamRef.current = cameraStreamRef.current;
        setMicStatus("ready");
      }
    }
  }, []);

  // 新用户：等 DeviceCheckModal 关闭后启动摄像头 + 倒计时
  // 老用户：initDone 时直接启动
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    if (showDeviceModal) {
      prevModalOpenRef.current = true;
    }
    if (initDone && devicePassed && !showDeviceModal && !startedRef.current) {
      const wasOpen = prevModalOpenRef.current;
      const delay = wasOpen ? 600 : 100;
      const t = setTimeout(() => {
        startedRef.current = true;
        initDevices();
        setMicReadyWait(true);
      }, delay);
      return () => clearTimeout(t);
    }
  }, [initDone, showDeviceModal, devicePassed, initDevices]);

  // 等待麦克风就绪后启动倒计时
  useEffect(() => {
    if (!micReadyWait) return;
    if (micStatus === "ready" || micStatus === "error") {
      setMicReadyWait(false);
      setCountdownKey(Date.now());
      return;
    }
    const timeout = setTimeout(() => {
      setMicReadyWait(false);
      console.warn("麦克风等待超时，强制启动倒计时");
      setCountdownKey(Date.now());
    }, 5000);
    return () => clearTimeout(timeout);
  }, [micReadyWait, micStatus]);

  // cameraStatus 变 ready 后 video 元素才渲染，此时把流挂上去
  useEffect(() => {
    if (cameraStatus === "ready" && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraStatus]);

  // 页面卸载清理
  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current?.getTracks().forEach((t) => { if (t.kind === "audio") t.stop(); });
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  const cameraReady = cameraStatus === "ready";
  const micReady = micStatus === "ready";

  // ---- 对话历史 ----
  const [history, setHistory] = useState<ConversationTurn[]>([]);

  // ---- AI 状态 ----
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [waitingForAiReply, setWaitingForAiReply] = useState(false);
  const [speechStage, setSpeechStage] = useState<SpeechProcessingStage>("idle");
  const startedRef = useRef(false);
  const [isFinal, setIsFinal] = useState(false);
  const [wrappingUp, setWrappingUp] = useState(false);
  const [replayAvailable, setReplayAvailable] = useState(false);
  const [retryingAiReply, setRetryingAiReply] = useState(false);
  const [lowQualityFlag, setLowQualityFlag] = useState<{ isLowQuality: boolean; reason: string } | null>(null);
  const lastAiAudioUrlRef = useRef<string>("");
  const lastAiTextRef = useRef<string>("");
  const [replaying, setReplaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speechStageTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ---- 轮次限制（客户端兜底）----
  const userTurnCount = history.filter((h) => h.role === "user").length;
  const turnLimitReached = userTurnCount >= ATTEMPT2_MAX_USER_TURNS;
  const canRecord = micReady && !uploading && !waitingForAiReply && !isFinal && !turnLimitReached && !wrappingUp && !aiSpeaking;

  const clearSpeechStageTimers = useCallback(() => {
    speechStageTimerRefs.current.forEach((timer) => clearTimeout(timer));
    speechStageTimerRefs.current = [];
  }, []);

  const scheduleSpeechProcessingStages = useCallback(() => {
    clearSpeechStageTimers();
    setSpeechStage("upload_complete");
    setCurrentSubtitle("上传完成");
    speechStageTimerRefs.current = [
      setTimeout(() => {
        setSpeechStage("asr_processing");
        setCurrentSubtitle("ASR 处理中...");
      }, 450),
      setTimeout(() => {
        setSpeechStage("waiting_model_reply");
        setCurrentSubtitle("等待模型回复...");
      }, 1650),
    ];
  }, [clearSpeechStageTimers]);

  // ---- 键盘提示自动消失 ----
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    if (cameraReady && showHint) {
      const timer = setTimeout(() => setShowHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [cameraReady, showHint]);

  // ---- 气泡列表自动滚动 ----
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [history.length]);

  // ---- 语音识别（Web Speech API）----
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const [speechSupported] = useState(() => {
    return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  });
  const [interimTranscript, setInterimTranscript] = useState("");
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");

  // ---- AI 开场白 ----
  // 不再在此直接启动倒计时，统一走 设备检测 → initDevices → 麦克风就绪 → 倒计时 流程

  // 倒计时结束：开始 AI 开场白
  useEffect(() => {
    if (countdownKey === null) return;
    const t = setTimeout(() => {
      setCountdownKey(null);
      void startAiOpening();
    }, 3100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownKey]);

  // 设备检测通过后的回调：记录通过状态但不关闭模态框（用户手动关闭）
  const handleDevicePassed = useCallback(() => {
    setDevicePassed(true);
  }, []);

  const startAiOpening = async () => {
    if (!task) return;
    setAiSpeaking(true);
    try {
      const res = await fetch(`${BASE_URL}/api/chat/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: (task as any)?.task_id ?? 0,
          is_variant: true,
          variant_context: task.variant_plot ?? "",
          scene_label: task.scene_label,
          roles: task.roles,
          goal: task.goal,
          evaluation_criteria: task.evaluation_criteria || "",
          opening_line: (task as any).opening_line || "",
        }),
      });
      if (res.ok) {
        const data = await res.json() as { ai_text: string; ai_audio_url?: string };
        setPendingAiSubtitle(data.ai_text);
        setHistory([{ role: "ai", text: data.ai_text, audio_url: data.ai_audio_url }]);

        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/")
            ? `${BASE_URL}${data.ai_audio_url}`
            : data.ai_audio_url;
          lastAiAudioUrlRef.current = fullUrl;
          lastAiTextRef.current = data.ai_text;
          playAiAudio(fullUrl, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
          });
        } else {
          lastAiTextRef.current = data.ai_text;
          playAiAudio(null, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
          });
        }
      } else {
        throw new Error(`${res.status}`);
      }
    } catch (err) {
      console.error("[startAiOpening] 失败:", err);
      const variantContext = task.variant_plot ?? "";
      const mockText = variantContext.includes("做错")
        ? "I'm sorry, but I think there might be a mistake with my order. Could you check this for me?"
        : variantContext.includes("优惠")
          ? "Welcome back! Today we have a special promotion. How can I help you?"
          : variantContext.includes("超重") || variantContext.includes("超售")
            ? "I'm sorry, but we have a situation with your booking. Let me explain..."
            : `Let's continue our conversation. ${getAiReply(task)}`;
      let mockAudioUrl = "";
      try {
        const ttsRes = await fetch(`${BASE_URL}/api/chat/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: mockText }) });
        if (ttsRes.ok) { const ttsData = await ttsRes.json() as { audio_url: string }; mockAudioUrl = ttsData.audio_url || ""; }
      } catch { /* ignore */ }
      setCurrentSubtitle(mockText);
      setHistory([{ role: "ai", text: mockText, audio_url: mockAudioUrl }]);
      if (mockAudioUrl) {
        const fullUrl = mockAudioUrl.startsWith("/") ? `${BASE_URL}${mockAudioUrl}` : mockAudioUrl;
        lastAiAudioUrlRef.current = fullUrl;
        lastAiTextRef.current = mockText;
        playAiAudio(fullUrl, mockText).finally(() => {
          setAiSpeaking(false);
          setReplayAvailable(true);
        });
      } else {
        lastAiTextRef.current = mockText;
        playAiAudio(null, mockText).finally(() => {
          setAiSpeaking(false);
          setReplayAvailable(true);
        });
      }
    }
  };

  // ---- 语音录制 ----
  const [pressing, setPressing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdBtnRef = useRef<HTMLButtonElement>(null);

  const beginRecord = useCallback(() => {
    if (!canRecord) return;
    if (!audioStreamRef.current || recording || uploading) return;

    setReplayAvailable(false);

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
      setSpeechStage("idle");
    };

    recorder.onstop = async () => {
      if (chunksRef.current.length === 0) {
        setSpeechStage("idle");
        return;
      }
      setUploading(true);
      setSpeechStage("uploading");

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

      const finalTranscript = finalTranscriptRef.current.trim();
      const interimTranscriptText = interimTranscriptRef.current.trim();
      const userText = finalTranscript || interimTranscriptText;
      const userTurn: ConversationTurn = {
        role: "user",
        text: userText || undefined,
        audio_url: audioUrl || undefined,
        final_transcript: finalTranscript || undefined,
        interim_transcript: interimTranscriptText || undefined,
        sent_user_text: userText || undefined,
      };
      const newHistory = [...history, userTurn];
      setHistory(newHistory);

      if (userText) {
        setCurrentSubtitle(`你说：${userText}`);
      }

      setUploading(false); // 上传完成，之后是 AI 处理
      scheduleSpeechProcessingStages();
      await callChatTurn(audioUrl, userText, newHistory);
    };

    recorder.start();
    setPressing(true);
    setRecording(true);
    setSpeechStage("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);

    // --- Speech Recognition ---
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setInterimTranscript("");
    setCurrentSubtitle("正在听你说话...");

    if (speechSupported) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;
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
        interimTranscriptRef.current = interim;

        const display = finalTranscriptRef.current +
          (interim ? (finalTranscriptRef.current ? " " : "") + interim : "");
        setCurrentSubtitle(display || "正在听你说话...");
      };

      recognition.onerror = (e: Event) => {
        const err = (e as any).error;
        if (err !== "aborted" && err !== "no-speech") console.warn("语音识别错误:", err);
      };

      recognition.onend = () => {
        // Web Speech 交付完所有结果后，停止录音器，保证文本已被 capture
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
        speechRecognitionRef.current = null;
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    }
  }, [recording, uploading, history, speechSupported, canRecord, scheduleSpeechProcessingStages]);

  const endRecord = useCallback(() => {
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!recording) return;

    // 停止 Web Speech，onend 里会调 recorder.stop()，保证文本已 capture
    speechRecognitionRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // 安全超时：如果 onend 3 秒内没触发，强制停录音器
    const timeoutId = setTimeout(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }, 3000);
    setTimeout(() => clearTimeout(timeoutId), 5000);
  }, [recording]);

  const callChatTurn = async (audio_url: string, user_text: string, currentHistory: ConversationTurn[]) => {
    // 剔除末尾用户轮次（后端 generate_reply 会单独追加 user_text，避免 LLM 收到重复消息）
    const historyForBackend = currentHistory.length > 0 && currentHistory[currentHistory.length - 1].role === "user"
      ? currentHistory.slice(0, -1)
      : currentHistory;
    // Plan A 自动收尾：用户达轮次上限时不再立即 setIsFinal，而是串行触发一次 chatTurn
    // 注入 WRAP_UP_HINT 让 AI 自然告别；失败时降级为通用告别模板
    if (turnLimitReached && !isFinal && !wrappingUp) {
      setWrappingUp(true);
      setWaitingForAiReply(true);
      clearSpeechStageTimers();
      setSpeechStage("wrapping_up");
      setCurrentSubtitle("AI 正在收尾...");
      setPendingAiSubtitle(null);
      console.info("[attempt2] Plan A 触发：自动调用 chatTurn 让 AI 收尾");
      try {
        const currentTask2 = taskRef.current;
        const wrapUpUserText = (user_text || "").trim() + (user_text ? " " : "") + WRAP_UP_HINT;
        const body: Record<string, unknown> = {
          task_id: (currentTask2 as any)?.id ?? 0,
          conversation_history: historyForBackend,
          scene_label: currentTask2?.scene_label || "",
          roles: currentTask2?.roles || "",
          goal: currentTask2?.goal || "",
          evaluation_criteria: currentTask2?.evaluation_criteria || "",
          variant_context: currentTask2?.variant_plot ?? "",
          closing_line: (currentTask2 as any)?.closing_line ?? "",
        };
        body.user_text = wrapUpUserText;
        body.audio_url = audio_url;
        const res = await fetch(`${BASE_URL}/api/chat/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json() as { ai_text: string; ai_audio_url?: string; is_final?: boolean; turn_feedback?: TurnFeedback; llm_error?: string; user_text?: string };
          // 模型调用失败：直接展示真实错误
          if (data.llm_error) {
            setSpeechStage("idle");
            setWaitingForAiReply(false);
            setAiSpeaking(false);
            const errorMsg = `[模型调用失败] ${data.llm_error}`;
            setPendingAiSubtitle(errorMsg);
            const errorTurn: ConversationTurn = {
              role: "ai",
              text: errorMsg,
              audio_url: "",
              error: true,
            };
            setHistory(prev => [...prev, errorTurn]);
            return;
          }
          setWaitingForAiReply(false);
          setAiSpeaking(true);
          setSpeechStage("ai_speaking");
          const aiTurn: ConversationTurn = {
            role: "ai",
            text: data.ai_text,
            audio_url: data.ai_audio_url,
            turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
            feedback_collapsed: false,
          };
          setHistory((prev) => {
            const resolvedUserText = data.user_text || wrapUpUserText;
            if (resolvedUserText) {
              const lastUserIdx = [...prev].reverse().findIndex(h => h.role === "user");
              if (lastUserIdx >= 0) {
                const idx = prev.length - 1 - lastUserIdx;
                return [
                  ...prev.slice(0, idx),
                  {
                    ...prev[idx],
                    text: data.user_text || prev[idx].text,
                    resolved_user_text: resolvedUserText,
                  },
                  ...prev.slice(idx + 1),
                  aiTurn,
                ];
              }
            }
            return [...prev, aiTurn];
          });
          setPendingAiSubtitle(data.ai_text);
          setIsFinal(true);
          if (data.ai_audio_url) {
            const fullUrl = data.ai_audio_url.startsWith("/")
              ? `${BASE_URL}${data.ai_audio_url}`
              : data.ai_audio_url;
            lastAiAudioUrlRef.current = fullUrl;
            lastAiTextRef.current = data.ai_text;
            playAiAudio(fullUrl, data.ai_text).finally(() => {
              setAiSpeaking(false);
              setReplayAvailable(true);
              setSpeechStage("idle");
            });
          } else {
            lastAiTextRef.current = data.ai_text;
            playAiAudio(null, data.ai_text).finally(() => {
              setAiSpeaking(false);
              setReplayAvailable(true);
              setSpeechStage("idle");
            });
          }
        } else {
          throw new Error(`${res.status}`);
        }
      } catch (err) {
        console.warn("[attempt2] Plan A 调用失败，降级:", err);
        const currentTask2 = taskRef.current;
        const fallbackText = (currentTask2 as any)?.closing_line
          ? ((currentTask2 as any).closing_line as string) + " [CONVERSATION_COMPLETE]"
          : FALLBACK_CLOSING;
        const aiTurn: ConversationTurn = { role: "ai", text: fallbackText };
        setHistory((prev) => [...prev, aiTurn]);
        setPendingAiSubtitle(fallbackText);
        setIsFinal(true);
        setWaitingForAiReply(false);
        setAiSpeaking(false);
        setSpeechStage("idle");
      } finally {
        setWrappingUp(false);
      }
      return;
    }
    if (isFinal) return;
    const currentTask = taskRef.current;
    setWaitingForAiReply(true);
    setPendingAiSubtitle(null); // 清空上一句的待显字幕
    try {
      const body: Record<string, unknown> = {
        task_id: (currentTask as any)?.task_id ?? 0,
        conversation_history: historyForBackend,
        scene_label: currentTask?.scene_label || "",
        roles: currentTask?.roles || "",
        goal: currentTask?.goal || "",
        evaluation_criteria: currentTask?.evaluation_criteria || "",
        variant_context: currentTask?.variant_plot ?? "",
      };
      body.user_text = user_text;  // Web Speech 文本作为兜底，后端优先 Whisper
      body.audio_url = audio_url;

      const res = await fetch(`${BASE_URL}/api/chat/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { ai_text: string; ai_audio_url?: string; is_final?: boolean; turn_feedback?: TurnFeedback; llm_error?: string; user_text?: string };
        // 模型调用失败：直接展示真实错误
        if (data.llm_error) {
          setSpeechStage("idle");
          setWaitingForAiReply(false);
          setAiSpeaking(false);
          const errorMsg = `[模型调用失败] ${data.llm_error}`;
          setPendingAiSubtitle(errorMsg);
          const errorTurn: ConversationTurn = {
            role: "ai",
            text: errorMsg,
            audio_url: "",
            error: true,
          };
          setHistory(prev => [...prev, errorTurn]);
          return;
        }
        clearSpeechStageTimers();
        setWaitingForAiReply(false);
        setAiSpeaking(true);
        setSpeechStage("ai_speaking");
        const aiTurn: ConversationTurn = {
          role: "ai",
          text: data.ai_text,
          audio_url: data.ai_audio_url,
          turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
          feedback_collapsed: false,
        };
        setHistory((prev) => {
          const resolvedUserText = data.user_text || user_text;
          if (resolvedUserText) {
            const lastUserIdx = [...prev].reverse().findIndex(h => h.role === "user");
            if (lastUserIdx >= 0) {
              const idx = prev.length - 1 - lastUserIdx;
              return [
                ...prev.slice(0, idx),
                {
                  ...prev[idx],
                  text: resolvedUserText,
                  resolved_user_text: resolvedUserText,
                },
                ...prev.slice(idx + 1),
                aiTurn,
              ];
            }
          }
          return [...prev, aiTurn];
        });
        // AI 说完：先存到 pending，等用户点击"显示字幕"才显示
        setPendingAiSubtitle(data.ai_text);

        // 质量检测
        setTimeout(() => {
          const prevAiTextForCheck = currentHistory.filter(h => h.role === "ai").pop()?.text || undefined;
          const checkResult = detectLowQualityReply(
            data.ai_text,
            prevAiTextForCheck,
            (taskRef.current as any)?.variant_plot || undefined,
          );
          setLowQualityFlag(checkResult);
        }, 0);

        if (data.is_final) {
          setIsFinal(true);
        }

        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/")
            ? `${BASE_URL}${data.ai_audio_url}`
            : data.ai_audio_url;
          lastAiAudioUrlRef.current = fullUrl;
          lastAiTextRef.current = data.ai_text;
          playAiAudio(fullUrl, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
            setSpeechStage("idle");
          });
        } else {
          lastAiTextRef.current = data.ai_text;
          playAiAudio(null, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
            setSpeechStage("idle");
          });
        }
      } else {
        throw new Error(`${res.status}`);
      }
    } catch {
      clearSpeechStageTimers();
      setWaitingForAiReply(false);
      setSpeechStage("idle");
      const mockText = getAiReply(task);
      const aiTurn: ConversationTurn = { role: "ai", text: mockText };
      setHistory((prev) => [...prev, aiTurn]);
      setPendingAiSubtitle(mockText);
      setTimeout(() => setAiSpeaking(false), 2000);
    }
  };

  // ---- 重新生成 AI 回复 ----
  const handleRetryAiReply = async () => {
    if (!history.length || retryingAiReply) return;
    
    // 找到最后一轮 AI 回复的索引
    const lastAiIndex = history.map(h => h.role).lastIndexOf("ai");
    if (lastAiIndex === -1) return;
    
    // 找到对应的用户轮次（在 AI 轮次之前）
    const userTurns = history.filter(h => h.role === "user");
    const lastUserTurn = userTurns[userTurns.length - 1];
    if (!lastUserTurn) return;
    
    const userText = lastUserTurn.resolved_user_text || lastUserTurn.sent_user_text || lastUserTurn.text || "";
    
    // 移除最后一轮 AI 回复
    const historyWithoutLastAi = history.slice(0, lastAiIndex);
    
    setRetryingAiReply(true);
    setLowQualityFlag(null);
    
    try {
      const currentTask = taskRef.current;
      const historyForBackend = historyWithoutLastAi.length > 0 && historyWithoutLastAi[historyWithoutLastAi.length - 1].role === "user"
        ? historyWithoutLastAi.slice(0, -1)
        : historyWithoutLastAi;
      
      const body: Record<string, unknown> = {
        task_id: (currentTask as any)?.task_id ?? 0,
        conversation_history: historyForBackend,
        scene_label: currentTask?.scene_label || "",
        roles: currentTask?.roles || "",
        goal: currentTask?.goal || "",
        evaluation_criteria: currentTask?.evaluation_criteria || "",
        variant_context: currentTask?.variant_plot ?? "",
      };
      body.user_text = userText;
      
      const res = await fetch(`${BASE_URL}/api/chat/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      if (res.ok) {
        const data = await res.json() as { ai_text: string; ai_audio_url?: string; is_final?: boolean; turn_feedback?: TurnFeedback; llm_error?: string; user_text?: string };
        
        if (data.llm_error) {
          alert("重试失败: " + data.llm_error);
          setRetryingAiReply(false);
          return;
        }
        
        const newAiTurn: ConversationTurn = {
          role: "ai",
          text: data.ai_text,
          audio_url: data.ai_audio_url,
          turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
          feedback_collapsed: false,
        };
        
        const newHistory = [...historyWithoutLastAi, newAiTurn];
        setHistory(newHistory);
        setPendingAiSubtitle(data.ai_text);
        
        if (data.is_final) {
          setIsFinal(true);
        }
        
        // 播放新生成的 AI 音频
        if (data.ai_audio_url) {
          const fullUrl = data.ai_audio_url.startsWith("/")
            ? `${BASE_URL}${data.ai_audio_url}`
            : data.ai_audio_url;
          lastAiAudioUrlRef.current = fullUrl;
          lastAiTextRef.current = data.ai_text;
          setAiSpeaking(true);
          setReplayAvailable(false);
          setSpeechStage("ai_speaking");
          playAiAudio(fullUrl, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
            setSpeechStage("idle");
          });
        } else {
          lastAiTextRef.current = data.ai_text;
          setAiSpeaking(true);
          setReplayAvailable(false);
          setSpeechStage("ai_speaking");
          playAiAudio(null, data.ai_text).finally(() => {
            setAiSpeaking(false);
            setReplayAvailable(true);
            setSpeechStage("idle");
          });
        }
      } else {
        throw new Error(`${res.status}`);
      }
    } catch {
      alert("重新生成失败，请稍后重试");
    } finally {
      setRetryingAiReply(false);
    }
  };

  // ---- 空格键长按 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!canRecord) return;
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
  }, [beginRecord, endRecord, canRecord]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      clearSpeechStageTimers();
    };
  }, [clearSpeechStageTimers]);

  // ---- 提交二次产出 ----
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (history.length < 2) { alert("请至少进行一轮对话"); return; }
    setSubmitting(true);
    try {
      const body = {
        task_id: (task as any)?.task_id ?? 0,
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
      localStorage.setItem(
        "attempt2_turn_traces",
        JSON.stringify(
          history
            .filter((h) => h.role === "user")
            .map((h, index) => ({
              turn_index: index + 1,
              final_transcript: h.final_transcript || "",
              interim_transcript: h.interim_transcript || "",
              sent_user_text: h.sent_user_text || "",
              resolved_user_text: h.resolved_user_text || h.text || "",
              audio_url: h.audio_url || "",
            }))
        )
      );
      // 保存 attempt2 完整对话文本供评价页使用
      const convText2 = history.map(h => `[${h.role}]: ${h.text || ""}`).filter(x => x).join("\n");
      localStorage.setItem("conversationText2", convText2);
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
    <TaskGate>
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
            <button onClick={() => setShowDevicePanel(!showDevicePanel)} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 hover:bg-muted transition-colors">
              <span className={`size-2 rounded-full ${cameraReady ? "bg-green-500" : "bg-red-500"}`} title="摄像头" />
              <span className={`size-2 rounded-full ${micReady ? "bg-green-500" : "bg-red-500"}`} title="麦克风" />
              <span className="text-muted-foreground">调试</span>
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
                {cameraStatus === "error" && (
                  <button onClick={initDevices} className="ml-2 text-xs text-primary underline hover:text-primary/80">重试</button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${micStatus === "ready" ? "bg-green-500" : micStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
                <span>麦克风: {micStatus === "ready" ? "正常" : micStatus === "error" ? "失败" : "初始化中"}</span>
              </div>
            </div>
            {micReady && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">音量:</span>
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
            {(uploading || waitingForAiReply) && <span className="text-white/60">{getProcessingStageLabel(speechStage)}</span>}
          </div>
        </div>

        {/* 右栏：AI 头像 + 对话气泡 */}
        <div className="relative flex-1 bg-card flex flex-col">
          {/* 上半段：AI 头像 + 字幕 + 重播按钮 */}
          <div className="flex flex-col items-center justify-center gap-6 pt-6 pb-2 shrink-0">
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
              <p className={`text-xs ${aiSpeaking || waitingForAiReply ? "text-primary animate-pulse" : "text-muted-foreground"}`}>
                {aiSpeaking ? "正在说话..." : recording ? "正在听..." : waitingForAiReply ? getProcessingStageLabel(speechStage) : "等待中"}
              </p>
              {waitingForAiReply && history.filter(h => h.role === "ai").length <= 1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 animate-in fade-in duration-300">首句回复可能需等待 10-30 秒，请耐心等待</p>
              )}
            </div>

            {/* 字幕区 — 实时转写 + AI 回复 */}
            <div className="max-w-[90%] rounded-xl bg-muted/50 px-4 py-2.5 text-center min-h-[3rem] flex items-center justify-center">
              {recording && interimTranscript ? (
                <p className="text-xs">
                  <span className="text-card-foreground">{currentSubtitle.replace(interimTranscript, "").trim()}</span>
                  {" "}
                  <span className="italic text-muted-foreground/70">{interimTranscript}</span>
                </p>
              ) : (
                <p className={`text-xs ${aiSpeaking ? "text-card-foreground" : "text-muted-foreground"}`}>
                  {currentSubtitle ? <ClickableEnglish text={currentSubtitle} /> : "按住下方按钮或空格键开始对话"}
                </p>
              )}
            </div>

            {/* 重播按钮 + 显示字幕按钮 同行 */}
            <div className="flex items-center gap-2">
              {/* 显示/隐藏对话记录 */}
              {history.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="inline-flex items-center justify-center size-9 rounded-full bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                  title={showHistory ? "隐藏对话记录" : "显示对话记录"}
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    {!showHistory && <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" />}
                  </svg>
                </button>
              )}
              {/* AI 语音重播按钮 */}
              {replayAvailable && !aiSpeaking && !recording && (
                <button
                  onClick={async () => {
                    setReplaying(true);
                    try {
                      const url = lastAiAudioUrlRef.current;
                      if (url) {
                        const audio = new Audio(url);
                        await new Promise<void>((resolve) => {
                          audio.onended = () => resolve();
                          audio.onerror = () => resolve();
                          audio.play().catch(() => resolve());
                        });
                      }
                      // 降级：浏览器 TTS
                      if (lastAiTextRef.current) {
                        await speakWithBrowserTTS(lastAiTextRef.current);
                      }
                    } catch { /* ignore */ }
                    setReplaying(false);
                  }}
                  disabled={replaying}
                  className="inline-flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  title="重播 AI 语音"
                >
                  {replaying ? (
                    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </button>
              )}
              {/* 显示字幕按钮：AI 说完后才出现 */}
              {pendingAiSubtitle && !aiSpeaking && !recording && (
                <button
                  onClick={() => {
                    setCurrentSubtitle(pendingAiSubtitle);
                    setPendingAiSubtitle(null);
                  }}
                  className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary/80 px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-2xl hover:shadow-primary/50 transition-all hover:scale-105 active:scale-95 animate-pulse"
                  title="查看 AI 的上一句话"
                >
                  <span className="absolute inset-0 rounded-full bg-primary/40 blur-md opacity-60 group-hover:opacity-100 animate-pulse" />
                  <svg className="relative size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span className="relative">显示字幕</span>
                </button>
              )}
              {/* 低质量回复重试按钮 */}
              {lowQualityFlag?.isLowQuality && !aiSpeaking && !retryingAiReply && (
                <button
                  onClick={handleRetryAiReply}
                  className="group relative inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 px-4 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900 transition-all hover:scale-105 active:scale-95"
                  title={lowQualityFlag.reason}
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>重新生成回复</span>
                </button>
              )}
            </div>

            {/* 低质量回复提示 */}
            {lowQualityFlag?.isLowQuality && !aiSpeaking && !retryingAiReply && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{lowQualityFlag.reason}</p>
            )}
            {/* 重试中加载态 */}
            {retryingAiReply && (
              <p className="text-xs text-muted-foreground animate-pulse">正在重新生成回复...</p>
            )}

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

          {/* 下半段：可滚动历史对话气泡列表 */}
          {showHistory && (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-2">
            {history.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                对话将在这里显示
              </div>
            ) : (
              history.map((h, i) => {
                const isUser = h.role === "user";
                const isError = h.error === true;
                const nextAi = i + 1 < history.length ? history[i + 1] : null;
                const fb = nextAi && nextAi.role === "ai" && nextAi.turn_feedback ? nextAi.turn_feedback : null;
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
                  <div key={i} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs ${
                        isUser
                          ? "bg-blue-500 text-white rounded-br-sm"
                          : isError
                            ? "bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200 rounded-bl-sm"
                            : "bg-gray-100 dark:bg-gray-800 rounded-bl-sm"
                      }`}
                    >
                      <ClickableEnglish text={h.text || ""} />
                    </div>
                    {isUser && (h.final_transcript || h.interim_transcript || h.sent_user_text || h.resolved_user_text) && (
                      <div className="mt-1 max-w-[75%] rounded-xl border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                        {h.final_transcript && <div>finalTranscript: {h.final_transcript}</div>}
                        {h.interim_transcript && <div>interimTranscript: {h.interim_transcript}</div>}
                        {h.sent_user_text && <div>实际发送 user_text: {h.sent_user_text}</div>}
                        {h.resolved_user_text && h.resolved_user_text !== h.sent_user_text && <div>后端采用文本: {h.resolved_user_text}</div>}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5 mb-0.5">
                      <span className={`text-[10px] ${isUser ? "text-blue-500" : "text-muted-foreground"}`}>
                        {isUser ? "你" : "AI"}
                      </span>
                      {isUser && fb && (
                        <div className="flex flex-wrap gap-0.5">
                          {fb.dimensions.map((d) => (
                            <span key={d} className={`rounded-full px-1.5 py-0 text-[9px] font-medium ${colorMap[d] || "bg-muted text-muted-foreground"}`}>{d}</span>
                          ))}
                          {fb.short_comment && (
                            <span className="text-[9px] text-muted-foreground/70 max-w-[200px] truncate">{fb.short_comment}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          )}
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

        {!devicePassed && (
          <p className="text-center text-xs text-rose-600">
            请先完成设备检测
            <button onClick={() => router.push("/device-check")} className="ml-2 underline hover:text-rose-800">
              去检测
            </button>
          </p>
        )}

        {(uploading || waitingForAiReply) && (
          <p className="text-center text-xs text-muted-foreground">
            {getProcessingStageLabel(speechStage)}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            ref={holdBtnRef}
            onMouseDown={() => { if (micReady && !uploading && !isFinal) beginRecord(); }}
            onMouseUp={endRecord}
            onMouseLeave={endRecord}
            onTouchStart={(e) => { e.preventDefault(); if (micReady && !uploading && !isFinal) beginRecord(); }}
            onTouchEnd={(e) => { e.preventDefault(); endRecord(); }}
            disabled={!micReady || uploading || waitingForAiReply || isFinal || !canRecord}
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
              : wrappingUp
                ? "AI 正在收尾..."
                : recording
                  ? `松开停止 (${formatTime(elapsed)})`
                  : uploading
                    ? "处理中..."
                    : waitingForAiReply
                      ? getProcessingStageLabel(speechStage)
                    : isFinal
                      ? "对话已结束"
                      : turnLimitReached
                        ? "已达到建议轮次"
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
          {turnLimitReached && (
            <span className="ml-2 text-xs text-muted-foreground">已达到建议轮次</span>
          )}
        </div>
      </div>

      {/* 设备检测模态框：自动唤起 */}
      <DeviceCheckModal
        open={showDeviceModal}
        onClose={() => setShowDeviceModal(false)}
        onPassed={handleDevicePassed}
      />

      {/* 3 秒倒计时发光特效 */}
      {countdownKey !== null && (
        <CountdownEffect key={countdownKey} seconds={3} onDone={() => {}} />
      )}
    </div>
    </TaskGate>
  );
}
