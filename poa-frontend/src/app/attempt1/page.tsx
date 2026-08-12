"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { BASE_URL, chatStart, chatTurn, type TurnFeedback } from "@/lib/api";
import { playAiAudio } from "@/lib/audio";
import RecordingWaveform from "@/components/RecordingWaveform";
import { getScenarioHistory, isTaskSelectedInSession, markTaskSelectedInSession, type ScenarioHistoryItem } from "@/lib/store";
import { isDeviceCheckPassed } from "@/lib/device-check";
import HistoryTaskSelector from "@/components/HistoryTaskSelector";
import ClickableEnglish from "@/components/ClickableEnglish";
import DeviceCheckModal from "@/components/DeviceCheckModal";
import CountdownEffect from "@/components/CountdownEffect";
import TaskGate from "@/components/TaskGate";
import { useStreamASR } from "@/lib/useStreamASR";

/* ============================================================
   常量
   ============================================================ */
// 用户在 attempt1 的最大发言轮次（达到后客户端自动结束对话，兜底 AI 漏标）
const ATTEMPT1_MAX_USER_TURNS = 6;
// 用户发言最少轮次（保留与现有 history.length < 2 检查一致的语义）
const MIN_USER_TURNS = 2;
// Plan A 触发时，附加到用户文本末尾的 system 提示，告知 LLM 需要告别并打结束标记
const WRAP_UP_HINT = "[system: conversation reached the turn limit. Please wrap up with a natural, scene-specific farewell and append [CONVERSATION_COMPLETE].]";
// Plan A 调用失败时使用的降级告别模板
const FALLBACK_CLOSING = "Thanks for chatting with me! Have a great day. [CONVERSATION_COMPLETE]";

/* ============================================================
   类型
   ============================================================ */
interface TaskData {
  scenario_id?: number;
  scene_label: string;
  roles: string;
  goal: string;
  evaluation_criteria?: string;
}

interface ConversationTurn {
  role: "user" | "ai";
  text?: string;
  audio_url?: string;
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
  | "processing"
  | "ai_speaking"
  | "wrapping_up";

function parseRoles(raw: string): { user: string; ai: string } {
  const splitRe = /(?:；|;)\s*B[:：]\s*/i;
  const parts = raw.split(splitRe);
  return {
    user: parts[0]?.replace(/^A[:：]\s*/i, "").trim() || "未指定",
    ai: parts[1]?.trim() || "未指定",
  };
}

/* ============================================================
   页面
   ============================================================ */
export default function Attempt1Page() {
  const router = useRouter();
  const t = useTranslations();

  // ---- stageToLabel（使用 t）----
  const stageToLabel = useCallback((stage: SpeechProcessingStage): string => {
    switch (stage) {
      case "recording": return t("attempt.recording");
      case "uploading": return t("attempt.uploading");
      case "processing": return t("attempt.processing");
      case "ai_speaking": return t("attempt.ai_speaking");
      case "wrapping_up": return t("attempt.ai_wrapping");
      default: return "";
    }
  }, [t]);

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
  const [showHistory, setShowHistory] = useState(false);
  const [devicePassed, setDevicePassed] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // ---- 设备模态框（自动唤起）----
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  // ---- 火山流式语音识别（WebSocket 代理，边说边出字幕）----
  const streamASR = useStreamASR();
  // ---- 3 秒倒计时 ----
  const [countdownKey, setCountdownKey] = useState<number | null>(null);
  const [pendingAiSubtitle, setPendingAiSubtitle] = useState<string | null>(null);
  // ---- 已锁定的字幕：用于在录音中保持显示 ----
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
    // 先清理旧流
    cameraStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    audioStreamRef.current?.getTracks().forEach((tr) => { if (tr.kind === "audio") tr.stop(); });
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
  // 老用户（已通过检测）：initDone 时 devicePassed 已 true，且 showDeviceModal 为 false，直接启动
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    // 追踪模态框是否曾经开着
    if (showDeviceModal) {
      prevModalOpenRef.current = true;
    }
    // 条件：(1) 页面就绪 (2) 设备已通过 (3) 模态框关了
    //         (4) 开局未开始  (5) 模态框要么从来没开过（老用户），要么刚刚关了（新用户）
    if (initDone && devicePassed && !showDeviceModal && !startedRef.current) {
      const wasOpen = prevModalOpenRef.current;
      // 如果从未开过模态框 = 老用户，立即启动
      // 如果刚关了 = 新用户，延迟 600ms 等 track 释放
      const delay = wasOpen ? 600 : 100;
      const tm = setTimeout(() => {
        startedRef.current = true;
        initDevices();
        setMicReadyWait(true);
      }, delay);
      return () => clearTimeout(tm);
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
      cameraStreamRef.current?.getTracks().forEach((tr) => tr.stop());
      audioStreamRef.current?.getTracks().forEach((tr) => { if (tr.kind === "audio") tr.stop(); });
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  // ---- 对话历史 ----
  const [history, setHistory] = useState<ConversationTurn[]>([]);

  // ---- 客户端轮次兜底：用户发言达到上限时自动结束对话 ----
  const userTurnCount = history.filter((h) => h.role === "user").length;
  const turnLimitReached = userTurnCount >= ATTEMPT1_MAX_USER_TURNS;

  // ---- AI 状态 ----
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [waitingForAiReply, setWaitingForAiReply] = useState(false);
  const [speechStage, setSpeechStage] = useState<SpeechProcessingStage>("idle");
  const startedRef = useRef(false);
  const [isFinal, setIsFinal] = useState(false);
  // ---- Plan A 自动收尾进行中：用于在 onstop 内串行化、防止重复触发 ----
  const [wrappingUp, setWrappingUp] = useState(false);
  const [replayAvailable, setReplayAvailable] = useState(false);
  const lastAiAudioUrlRef = useRef<string>("");
  const lastAiTextRef = useRef<string>("");
  const [replaying, setReplaying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 浏览器 ASR 实时转录文本，在 onstop 回调中使用
  const browserTextRef = useRef("");

  // ---- 气泡列表自动滚动 ----
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [history.length]);

  // ---- 键盘提示自动消失 ----
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    if (cameraStatus === "ready" && showHint) {
      const timer = setTimeout(() => setShowHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [cameraStatus, showHint]);

  // ---- AI 开场白 ----
  // 不再在此直接启动倒计时，统一走 设备检测 → initDevices → 麦克风就绪 → 倒计时 流程

  // 倒计时结束：开始 AI 开场白
  useEffect(() => {
    if (countdownKey === null) return;
    const tm = setTimeout(() => {
      setCountdownKey(null);
      void startAiOpening();
    }, 3100);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownKey]);

  // 设备检测通过后的回调：记录通过状态但不关闭模态框（用户手动关闭）
  const handleDevicePassed = useCallback(() => {
    setDevicePassed(true);
  }, []);

  const startAiOpening = async () => {
    if (!task) return;
    setWaitingForAiReply(true);
    setCurrentSubtitle(t("attempt.preparing_opening"));
    try {
      const data = await chatStart(
        task.scene_label,
        task.roles,
        task.goal,
        task.evaluation_criteria,
        undefined,
        (task as any).opening_line || ""
      );
      setWaitingForAiReply(false);
      setPendingAiSubtitle(data.ai_text);
      setHistory([{ role: "ai", text: data.ai_text, audio_url: data.ai_audio_url }]);
      {
        const fullUrl = data.ai_audio_url
          ? (data.ai_audio_url.startsWith("/") ? `${BASE_URL}${data.ai_audio_url}` : data.ai_audio_url)
          : "";
        if (!fullUrl) {
          console.warn("[startAiOpening] TTS 音频 URL 为空，后端未生成语音。检查 DOUBAO_TTS_*/gTTS 配置。");
          setSpeechStage("idle");
          setReplayAvailable(false);
        }
        if (fullUrl) lastAiAudioUrlRef.current = fullUrl;
        lastAiTextRef.current = data.ai_text;
        playAiAudio(fullUrl || null, (isPlaying) => {
          setAiSpeaking(isPlaying);
          if (isPlaying) {
            setSpeechStage("ai_speaking");
          } else {
            setSpeechStage("idle");
            setReplayAvailable(true);
          }
        });
      }
    } catch (err) {
      console.error("[startAiOpening] LLM 失败:", err);
      setWaitingForAiReply(false);
      setCurrentSubtitle(t("attempt.opening_failed"));
      setAiSpeaking(false);
    }
  };

  // ---- 录音 ----
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false); // 防 beginRecord 重复触发
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 录音可达性派生（前置以避免 TDZ 报错）----
  const micReady = micStatus === "ready";
  const canRecord = micReady && !uploading && !waitingForAiReply && !aiSpeaking && !isFinal && !turnLimitReached && !wrappingUp;

  // ---- 通话轮次 ----
  const callChatTurn = async (user_text: string, currentHistory: ConversationTurn[]) => {
    // 剔除末尾用户轮次（后端 generate_reply 会单独追加 user_text，避免 LLM 收到重复消息）
    const historyForBackend = currentHistory.length > 0 && currentHistory[currentHistory.length - 1].role === "user"
      ? currentHistory.slice(0, -1)
      : currentHistory;
    const currentTask = taskRef.current;
    if (isFinal) return;
    setWaitingForAiReply(true);
    setPendingAiSubtitle(null); // 清空上一句的待显字幕
    try {
      const data = await chatTurn(
        user_text,
        historyForBackend,
        currentTask?.scene_label || "",
        currentTask?.roles || "",
        currentTask?.goal,
        currentTask?.evaluation_criteria
      );

      // 模型调用失败：前端直接展示真实错误
      if (data.llm_error) {
        setSpeechStage("idle");
        setUploading(false);
        setAiSpeaking(false);
        setWaitingForAiReply(false);
        const errorMsg = `[${t("attempt.model_failed_tag")}] ${data.llm_error}`;
        setCurrentSubtitle(errorMsg);
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
      setSpeechStage("processing");
      const aiTurn: ConversationTurn = {
        role: "ai",
        text: data.ai_text,
        audio_url: data.ai_audio_url,
        turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
        feedback_collapsed: false,
      };
      setHistory((prev) => {
        let resolvedUserText = data.user_text || "";
        if (!resolvedUserText && data.asr_error) {
          resolvedUserText = t("attempt.asr_failed", { error: data.asr_error });
        }
        if (resolvedUserText) {
          console.log("[backfill] model user_text:", resolvedUserText);
          const lastUserIdx = [...prev].reverse().findIndex((h) => h.role === "user");
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
        } else {
          resolvedUserText = t("attempt.asr_no_result");
          console.log("[backfill] no user_text from server, asr_error:", data.asr_error || "无");
        }
        return [...prev, aiTurn];
      });
      // AI 说完：先存到 pending，等用户点击"显示字幕"才显示
      setPendingAiSubtitle(data.ai_text);
      if (data.is_final) {
        setIsFinal(true);
      }
      if (data.ai_audio_url) {
        const fullUrl = data.ai_audio_url.startsWith("/") ? `${BASE_URL}${data.ai_audio_url}` : data.ai_audio_url;
        lastAiAudioUrlRef.current = fullUrl;
        lastAiTextRef.current = data.ai_text;
        playAiAudio(fullUrl, (isPlaying) => {
          setAiSpeaking(isPlaying);
          if (isPlaying) {
            setSpeechStage("ai_speaking");
          } else {
            setAiSpeaking(false);
            setReplayAvailable(true);
            setSpeechStage("idle");
          }
        });
      } else {
        lastAiTextRef.current = data.ai_text;
        // 无音频，不需要设置 ai_speaking
        setAiSpeaking(false);
        setReplayAvailable(true);
        setSpeechStage("idle");
      }
    } catch (err: any) {
      console.error("[callChatTurn] 失败:", err);
      setWaitingForAiReply(false);
      setUploading(false);
      setAiSpeaking(false);
      setSpeechStage("idle");
      const errText = err?.message || String(err);
      const dialogFailedMsg = t("attempt.dialog_failed", { error: errText });
      setCurrentSubtitle(dialogFailedMsg);
      const requestFailedTag = t("attempt.request_failed_tag");
      setHistory(prev => [...prev, { role: "ai", text: `[${requestFailedTag}] ${errText}`, error: true } as ConversationTurn]);
    }
  };

  const beginRecord = useCallback(() => {
    // 客户端轮次兜底：达到上限或对话已结束时不进入录音
    if (!canRecord) return;
    if (!audioStreamRef.current || recording || uploading) return;
    // 防重复：用 ref 追踪真实录制状态
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;

    // 用户手势后恢复 AudioContext：浏览器自动播放策略会让无手势创建的 context 处于 suspended，
    // 此时 analyser 返回全零数据，波形无法反映真实音量
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }

    // 启动火山流式语音识别（WebSocket → 后端 → 火山 ASR）
    streamASR.start();

    setReplayAvailable(false);

    // 移动端检测
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 音频轨道健康检查
    const audioTracks = audioStreamRef.current.getAudioTracks();
    const activeTracks = audioTracks.filter(tr => tr.readyState === "live");
    console.log(`[attempt1] 音频轨道: total=${audioTracks.length}, live=${activeTracks.length}, isMobile=${isMobile}`);
    if (activeTracks.length === 0) {
      console.error("[attempt1] 没有活跃的音频轨道，无法录制");
      isRecordingRef.current = false;
      setCurrentSubtitle(t("attempt.mic_retry"));
      return;
    }

    // 移动端避免 codecs=opus（Android Chrome bug：静音录音）
    let mimeType: string;
    if (isMobile) {
      mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      console.log("[attempt1] 移动端 MIME: " + (mimeType || "默认"));
    } else {
      mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
    }

    let recorder: MediaRecorder;
    try {
      const opts: MediaRecorderOptions = mimeType ? { mimeType } : {};
      if (isMobile && mimeType.includes("webm")) {
        opts.audioBitsPerSecond = 64000;
      }
      recorder = new MediaRecorder(audioStreamRef.current, opts);
    } catch (err: unknown) {
      console.error("[attempt1] MediaRecorder 创建失败:", (err as Error)?.message);
      isRecordingRef.current = false;
      const errMsg = (err as Error)?.message ?? "";
      alert(t("attempt.cannot_start_recording") + errMsg);
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onerror = () => {
      console.error("[attempt1] MediaRecorder onerror");
      isRecordingRef.current = false;
      setRecording(false);
      setSpeechStage("idle");
    };
    recorder.onstop = async () => {
      // 停止火山流式语音识别，获取最终转写文本
      let asrResult = "";
      try { asrResult = (await streamASR.stop()) || ""; } catch { /* ignore */ }
      browserTextRef.current = asrResult;
      console.log("[attempt1] streamASR 结果:", JSON.stringify(browserTextRef.current));

      if (chunksRef.current.length === 0) {
        setSpeechStage("idle");
        return;
      }
      setUploading(true);
      setSpeechStage("uploading");
      setCurrentSubtitle(t("attempt.uploading"));
      let audioUrl = "";
      let uploadFailed = false;
      try {
        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const form = new FormData();
        form.append("file", blob, `turn-${Date.now()}.${ext}`);
        const uploadRes = await fetch(`${BASE_URL}/api/upload/audio`, { method: "POST", body: form });
        if (uploadRes.ok) {
          const upData = await uploadRes.json() as { audio_url: string };
          audioUrl = upData.audio_url;
        } else {
          console.error("[attempt1] 上传失败:", uploadRes.status, await uploadRes.text().catch(() => ""));
          uploadFailed = true;
        }
      } catch (err) {
        console.error("[attempt1] 上传异常:", err);
        uploadFailed = true;
      }

      if (uploadFailed) {
        setUploading(false);
        setSpeechStage("idle");
        setCurrentSubtitle(t("attempt.upload_failed"));
        const failedTag = t("attempt.upload_failed_tag");
        setHistory((prev) => [...prev, { role: "user", text: `[${failedTag}]`, error: true } as ConversationTurn]);
        return;
      }

      const userTurn: ConversationTurn = {
        role: "user",
        text: browserTextRef.current || undefined,
        sent_user_text: browserTextRef.current || undefined,
        audio_url: audioUrl || undefined,
      };
      const newHistory = [...history, userTurn];
      setHistory(newHistory);
      setUploading(false); // 上传完成，之后是 AI 处理
      setSpeechStage("processing");
      setCurrentSubtitle(t("attempt.processing"));

      // Plan A 自动收尾：用户达轮次上限时不再立即 setIsFinal，而是串行触发一次 chatTurn
      // 注入 WRAP_UP_HINT 让 AI 自然告别；失败时降级为通用告别模板
      if (turnLimitReached && !isFinal && !wrappingUp) {
        const currentTask2 = taskRef.current;
        setWrappingUp(true);
        setWaitingForAiReply(true);
        setSpeechStage("wrapping_up");
        setCurrentSubtitle(t("attempt.ai_wrapping"));
        setPendingAiSubtitle(null);
        // 剔除末尾用户轮次，避免 LLM 收到重复消息
        const historyForPlanA = newHistory.length > 0 && newHistory[newHistory.length - 1].role === "user"
          ? newHistory.slice(0, -1)
          : newHistory;
        console.info("[attempt1] Plan A 触发：自动调用 chatTurn 让 AI 收尾");
        try {
          const wrapUpUserText = (browserTextRef.current || "") + " " + WRAP_UP_HINT;
          const data = await chatTurn(
            wrapUpUserText,
            historyForPlanA,
            currentTask2?.scene_label || "",
            currentTask2?.roles || "",
            currentTask2?.goal,
            currentTask2?.evaluation_criteria,
            (currentTask2 as any)?.closing_line ?? ""
          );
          setWaitingForAiReply(false);
          const aiTurn: ConversationTurn = {
            role: "ai",
            text: data.ai_text,
            audio_url: data.ai_audio_url,
            turn_feedback: data.turn_feedback && data.turn_feedback.short_comment ? data.turn_feedback : undefined,
            feedback_collapsed: false,
          };
          setHistory((prev) => {
            const resolvedUserText = data.user_text || wrapUpUserText;
            const lastUserIdx = [...prev].reverse().findIndex((h) => h.role === "user");
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
            return [...prev, aiTurn];
          });
          setPendingAiSubtitle(data.ai_text);
          setIsFinal(true);
          if (data.ai_audio_url) {
            const fullUrl = data.ai_audio_url.startsWith("/") ? `${BASE_URL}${data.ai_audio_url}` : data.ai_audio_url;
            lastAiAudioUrlRef.current = fullUrl;
            lastAiTextRef.current = data.ai_text;
            playAiAudio(fullUrl, (isPlaying) => {
              setAiSpeaking(isPlaying);
              if (isPlaying) {
                setSpeechStage("ai_speaking");
              } else {
                setAiSpeaking(false);
                setReplayAvailable(true);
                setSpeechStage("idle");
              }
            });
          } else {
            setAiSpeaking(false);
            setSpeechStage("idle");
          }
        } catch (err) {
          console.warn("[attempt1] Plan A 调用失败，降级:", err);
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
      const browserText = browserTextRef.current;
      const userTextForBackend = browserText || "";
      console.log("[attempt1] 流式 ASR 转录:", browserText || t("attempt.no_text"));
      await callChatTurn(userTextForBackend, newHistory);
    };
    recorder.onstart = () => {
      console.log(`[attempt1] MediaRecorder started, state=${recorder.state}, mime=${recorder.mimeType}, isMobile=${isMobile}`);
    };
    recorder.start(isMobile ? 1000 : undefined);
    console.log(`[attempt1] recorder.start(${isMobile ? 1000 : "无参数"}) 已调用`);
    setRecording(true);
    setSpeechStage("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    setCurrentSubtitle(t("attempt.listening_prompt"));
  }, [recording, uploading, history, canRecord, isFinal, turnLimitReached, wrappingUp, t, streamASR]);

  const endRecord = useCallback(() => {
    if (!isRecordingRef.current) return; // 已经在结束中或从未开始
    isRecordingRef.current = false;
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // 强制停止录音器（不依赖 React 状态，防闭包过时）
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch (e) {
        console.warn("[attempt1] recorder.stop() 异常:", e);
      }
    }
  }, []);

  // ---- 空格键（点击切换）----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && document.activeElement === document.body) {
        e.preventDefault();
        if (recording) { endRecord(); } else if (canRecord) { beginRecord(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [beginRecord, endRecord, canRecord, recording]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ---- 提交诊断 ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const handleSubmit = async () => {
    if (history.length < MIN_USER_TURNS) { setSubmitError(t("attempt.min_one_round")); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const conversationText = history
        .map((h) => {
          const roleLabel = h.role === "ai" ? t("attempt.ai") : t("attempt.you");
          return `[${roleLabel}]: ${h.text || ""}`;
        })
        .filter((s) => s.trim().length > 0)
        .join("\n");
      localStorage.setItem("conversationText", conversationText);
      localStorage.setItem(
        "attempt1_turn_traces",
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
      // 收集用户录音的 audio_url，供后续评价页进行发音分析
      const audioUrls = history.filter(h => h.role === "user" && h.audio_url).map(h => h.audio_url);
      if (audioUrls.length > 0) {
        localStorage.setItem("attempt1_audio_urls", JSON.stringify(audioUrls));
      }
      const taskId = (taskRef.current as any)?.task_id;
      const res = await fetch(`${BASE_URL}/api/attempt1/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id: taskId ?? 0, attempt_text: conversationText || "[no speech]", attempt_number: 1, audio_urls: audioUrls }) });
      if (!res.ok) {
        const detail = await res.text().catch(() => t("common.error_unknown"));
        throw new Error(`服务器返回错误 (${res.status}): ${detail}`);
      }
      const data = await res.json();
      localStorage.setItem("diagnosis", JSON.stringify(data));
      // 保存 attempt_id 和请求体，供诊断页异步加载七维评分
      if (data.attempt_id) {
        localStorage.setItem("attempt1_id", String(data.attempt_id));
      }
      localStorage.setItem("attempt1_submit_body", JSON.stringify({ task_id: taskId ?? 0, attempt_text: conversationText || "[no speech]", attempt_number: 1, audio_urls: audioUrls }));
      router.push("/diagnosis");
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
        setSubmitError(t("attempt.cannot_connect"));
      } else if (msg.includes("服务器返回错误")) {
        setSubmitError(msg);
      } else {
        setSubmitError(t("attempt.submit_failed", { error: msg }));
      }
    } finally { setSubmitting(false); }
  };

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const { user, ai } = task ? parseRoles(task.roles) : { user: "", ai: "" };

  // ---- dimLabels (使用 t) ----
  const dimLabels = useMemo(() => ({
    grammar: t("attempt.dim_grammar"),
    vocabulary: t("attempt.dim_vocabulary"),
    coherence: t("attempt.dim_coherence"),
  }), [t]);

  // ---- 加载中 ----
  if (!initDone) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="text-center text-muted-foreground">{t("common.loading")}</div></div>;
  }

  // ---- 有历史任务 ----
  if (hasHistory) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="w-full max-w-md px-4"><HistoryTaskSelector onSelected={(item: ScenarioHistoryItem) => { markTaskSelectedInSession(); const taskData: TaskData = { scene_label: item.sceneLabel, roles: item.roles, goal: item.goal, evaluation_criteria: item.task?.evaluation_criteria }; localStorage.setItem("currentTask", JSON.stringify(taskData)); taskRef.current = taskData; setLocalTask(taskData); setHasHistory(false); }} /></div></div>;
  }

  // ---- 无任务 ----
  if (!task) {
    return <div className="flex h-[calc(100vh-100px)] items-center justify-center"><div className="text-center"><h1 className="text-xl font-bold">{t("attempt.title_1")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("common.please_select_scene_first")}</p><Button className="mt-4" variant="outline" onClick={() => router.push("/scenario")}>{t("common.back_to_scenario")}</Button></div></div>;
  }

  /* ============================================================
     Render
     ============================================================ */
  const cameraReady = cameraStatus === "ready";
  const recordDisabledReason = !devicePassed
    ? t("attempt.please_do_device_check")
    : !micReady
    ? t("attempt.mic_not_ready")
    : uploading
    ? t("attempt.uploading")
    : waitingForAiReply
    ? stageToLabel(speechStage)
    : aiSpeaking
    ? t("attempt.ai_speaking")
    : isFinal
    ? t("attempt.dialog_ended")
    : turnLimitReached
      ? t("attempt.turn_limit_reached")
      : "";

  return (
    <TaskGate>
      <div className="flex h-[calc(100vh-100px)] flex-col">
      {/* 顶部任务摘要 */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">{task.scene_label}</span>
            <span className="text-muted-foreground">{user.split("——")[0]} × {ai.split("——")[0]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-amber-600 dark:text-amber-400">{t("attempt.system_loading_slow")}</span>
            {/* 设备检测独立页入口 */}
            <button
              onClick={() => router.push("/device-check")}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
                devicePassed
                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  : "bg-rose-100 text-rose-700 hover:bg-rose-200"
              }`}
              title={devicePassed ? t("attempt.device_checked") : t("attempt.click_to_check")}
            >
              <span className={`size-2 rounded-full ${devicePassed ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span>🎛 {devicePassed ? t("attempt.device_ready") : t("attempt.device_check")}</span>
            </button>
            {/* 设备状态指示器 */}
            <button onClick={() => setShowDevicePanel(!showDevicePanel)} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 hover:bg-muted transition-colors">
              <span className={`size-2 rounded-full ${cameraReady ? "bg-green-500" : "bg-red-500"}`} title={t("attempt.camera")} />
              <span className={`size-2 rounded-full ${micReady ? "bg-green-500" : "bg-red-500"}`} title={t("attempt.microphone")} />
              <span className="text-muted-foreground">{t("attempt.debug")}</span>
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
              <span className="text-xs">{t("attempt.camera_label")}{cameraStatus === "ready" ? t("attempt.normal") : cameraStatus === "error" ? t("attempt.failed") : t("attempt.initializing")}</span>
              {cameraStatus === "error" && (
                <button onClick={initDevices} className="ml-2 text-xs text-primary underline hover:text-primary/80">{t("attempt.retry")}</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${micStatus === "ready" ? "bg-green-500" : micStatus === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
              <span className="text-xs">{t("attempt.mic_label")}{micStatus === "ready" ? t("attempt.normal") : micStatus === "error" ? t("attempt.failed") : t("attempt.initializing")}</span>
            </div>
          </div>
          {micReady && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("attempt.volume")}</span>
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
          <p className="text-xs text-muted-foreground/60">{t("attempt.click_blank_to_close")}</p>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 border-r border-border bg-black">
          {cameraReady ? <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" /> : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span>{t("attempt.camera_not_ready")}</span>
              {cameraStatus === "error" && <span className="text-xs text-amber-500">{t("attempt.please_allow_camera")}</span>}
            </div>
          )}
          <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1 text-xs text-white backdrop-blur">
            {user.split("——")[0]}
            {recording && <span className="flex items-center gap-1"><span className="size-1.5 animate-pulse rounded-full bg-red-500" />{formatTime(elapsed)}</span>}
            {(uploading || waitingForAiReply) && <span className="text-white/60">{stageToLabel(speechStage)}</span>}
          </div>
        </div>

        {/* 右栏：AI 头像 + 对话气泡 */}
        <div className="relative flex-1 bg-card flex flex-col">
          {/* 上半段：AI 头像 + 字幕 + 重播按钮 */}
          <div className="flex flex-col items-center justify-center gap-6 pt-6 pb-2 shrink-0">
            <div className="relative">
              <div className="flex size-32 items-center justify-center rounded-full bg-linear-to-br from-primary/20 to-primary/5 ring-4 ring-border">
                <svg className="size-16 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" /><path d="M9 15c.83.67 1.83 1 3 1s2.17-.33 3-1" /></svg>
              </div>
              {aiSpeaking && <><span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/30" /><span className="absolute -inset-3 animate-ping rounded-full border border-primary/20 [animation-delay:300ms]" /><span className="absolute -inset-6 animate-ping rounded-full border border-primary/10 [animation-delay:600ms]" /></>}
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-card-foreground">{ai.split("——")[0]}</p>
              <p className={`text-xs ${aiSpeaking || waitingForAiReply ? "text-primary animate-pulse" : "text-muted-foreground"}`}>
                {aiSpeaking ? t("attempt.speaking") : recording ? t("attempt.listening") : waitingForAiReply ? stageToLabel(speechStage) : t("attempt.waiting")}
              </p>
              {waitingForAiReply && history.filter(h => h.role === "ai").length <= 1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 animate-in fade-in duration-300">{t("attempt.first_reply_slow")}</p>
              )}
            </div>
            <div className="max-w-[90%] rounded-xl bg-muted/50 px-4 py-2.5 text-center min-h-[3rem] flex flex-col items-center justify-center gap-1">
              {/* 录音中：显示火山流式实时识别字幕 */}
              {recording && streamASR.isRecording && streamASR.interimText && (
                <p className="text-xs text-primary/80 animate-pulse">
                  {streamASR.interimText}
                </p>
              )}
              {/* 流式 ASR 错误提示 */}
              {recording && streamASR.error && (
                <p className="text-xs text-destructive">{streamASR.error}</p>
              )}
              <p className={`text-xs ${aiSpeaking ? "text-card-foreground" : "text-muted-foreground"}`}>
                {currentSubtitle ? <ClickableEnglish text={currentSubtitle} /> : t("attempt.click_or_space")}
              </p>
            </div>
            {/* 重播按钮 + 显示字幕按钮 同行 */}
            <div className="flex items-center gap-2">
              {/* 显示/隐藏对话记录 */}
              {history.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="inline-flex items-center justify-center size-9 rounded-full bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                  title={showHistory ? t("attempt.hide_history") : t("attempt.show_history")}
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
                        playAiAudio(url, (isPlaying) => {
                          if (!isPlaying) setReplaying(false);
                        });
                      } else {
                        setReplaying(false);
                      }
                    } catch { /* ignore */ }
                  }}
                  disabled={replaying}
                  className="inline-flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  title={t("attempt.replay_ai")}
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
                title={t("attempt.view_last_ai")}
              >
                <span className="absolute inset-0 rounded-full bg-primary/40 blur-md opacity-60 group-hover:opacity-100 animate-pulse" />
                <svg className="relative size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="relative">{t("attempt.show_subtitle")}</span>
              </button>
            )}
            </div>
            <p className="text-xs text-muted-foreground/60">{t("attempt.dialog_rounds", { count: history.length })}</p>
          </div>

          {/* 下半段：可滚动历史对话气泡列表 */}
          {showHistory && (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-2">
            {history.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                {t("attempt.dialog_placeholder")}
              </div>
            ) : (
              history.map((h, i) => {
                const isUser = h.role === "user";
                const isError = h.error === true;
                const nextAi = i + 1 < history.length ? history[i + 1] : null;
                const fb = nextAi && nextAi.role === "ai" && nextAi.turn_feedback ? nextAi.turn_feedback : null;
                // 三维评分条（颜色：语法=红 词汇=紫 话轮=青）
                const dimColors: Record<string, string> = {
                  grammar: "bg-rose-500",
                  vocabulary: "bg-violet-500",
                  coherence: "bg-cyan-500",
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
                        {isUser ? t("attempt.you") : t("attempt.ai")}
                      </span>
                      {isUser && fb && (() => {
                        const sc = fb.scores;
                        return (
                        <div className="flex flex-col gap-0.5 max-w-[220px]">
                          {sc && (
                            <div className="flex items-center gap-1.5">
                              {(["grammar", "vocabulary", "coherence"] as const).map((dim) => (
                                <div key={dim} className="flex items-center gap-0.5">
                                  <span className="text-[8px] text-muted-foreground/60 w-5">{dimLabels[dim]}</span>
                                  <div className="w-6 h-1 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${dimColors[dim]}`}
                                      style={{ width: `${sc[dim]}%` }}
                                    />
                                  </div>
                                  <span className="text-[8px] font-semibold text-muted-foreground tabular-nums w-4">{sc[dim]}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {fb.short_comment && (
                            <span className="text-[9px] text-muted-foreground/70 truncate">{fb.short_comment}</span>
                          )}
                        </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          )}
        </div>
      </div>

      {/* 底部控制栏 */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-2">
        <RecordingWaveform isRecording={recording} analyserRef={analyserRef} />
        {isFinal && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-4 py-2.5 text-center">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">{t("attempt.dialog_done_1")}</p>
          </div>
        )}
        {!canRecord && recordDisabledReason && (
          <p className="text-center text-xs text-rose-600">
            {recordDisabledReason}
            {!devicePassed && (
              <button onClick={() => router.push("/device-check")} className="ml-2 underline hover:text-rose-800">
                {t("attempt.go_check")}
              </button>
            )}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (!canRecord) return;
              if (recording) { endRecord(); } else { beginRecord(); }
            }}
            disabled={!canRecord && !recording}
            title={recording ? t("attempt.click_stop_recording") : t("attempt.click_start_speaking")}
            className={`shrink-0 select-none rounded-full px-8 py-3 text-sm font-semibold transition-all duration-150 active:scale-95 ${
              recording
                ? elapsed >= 28
                  ? "bg-destructive text-destructive-foreground shadow-lg scale-105 animate-pulse"
                  : elapsed >= 25
                    ? "bg-amber-500 text-white shadow-lg scale-105"
                    : "bg-destructive text-destructive-foreground shadow-lg scale-105"
                : !micReady
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : uploading || isFinal || turnLimitReached
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:bg-primary/90"
            }`}>
            {!micReady ? t("attempt.mic_not_ready") : wrappingUp ? t("attempt.ai_wrapping") : recording ? `${t("attempt.click_stop")} (${formatTime(elapsed)})` : uploading || waitingForAiReply ? stageToLabel(speechStage) : isFinal ? t("attempt.dialog_ended") : turnLimitReached ? t("attempt.turn_limit_reached") : t("attempt.click_speak")}
          </button>
          {showHint && micReady && <span className="hidden sm:inline text-xs text-muted-foreground/60 animate-in fade-in duration-300">{t("attempt.or_space_toggle")}</span>}
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={handleSubmit} disabled={submitting || history.length < MIN_USER_TURNS}>{submitting ? t("attempt.submitting") : t("attempt.submit_diagnosis")}</Button>
          {turnLimitReached && (
            <span className="ml-2 text-xs text-muted-foreground">{t("attempt.turn_limit_reached")}</span>
          )}
        </div>
        {submitError && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2.5">
            <div className="flex items-start gap-2">
              <svg className="size-4 text-red-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                <button
                  onClick={() => { setSubmitError(null); handleSubmit(); }}
                  className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:text-red-800"
                >
                  {t("attempt.click_retry")}
                </button>
              </div>
              <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
        )}
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