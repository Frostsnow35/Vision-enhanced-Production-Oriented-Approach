"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import RecordingWaveform from "@/components/RecordingWaveform";

/* ============================================================
   类型定义
   ============================================================ */
interface TaskData {
  scene_label: string;
  roles: string;
  goal: string;
  context_constraints: string;
  evaluation_criteria: string;
  variant_plot: string;
  id?: number;
  scenario_id?: number;
}

interface TurnRecord {
  user_audio_url: string;
  ai_text: string;
  user_text: string;
}

// API_URL imported from @/lib/api

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

/* ============================================================
   AI 头像组件
   ============================================================ */
function AiAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative flex flex-col items-center gap-4">
      {/* 声波扩散环 */}
      <div className="relative flex items-center justify-center">
        {speaking && (
          <>
            <span
              className="absolute rounded-full bg-primary/20"
              style={{
                width: 130,
                height: 130,
                animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
              }}
            />
            <span
              className="absolute rounded-full bg-primary/12"
              style={{
                width: 150,
                height: 150,
                animation: "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite 0.3s",
              }}
            />
            <span
              className="absolute rounded-full bg-primary/8"
              style={{
                width: 170,
                height: 170,
                animation: "ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.6s",
              }}
            />
          </>
        )}

        {/* SVG 人物头像 */}
        <svg
          width="100"
          height="100"
          viewBox="0 0 100 100"
          className={`relative z-10 transition-transform duration-300 ${
            speaking ? "scale-105" : "scale-100"
          }`}
        >
          {/* 背景圆 */}
          <circle cx="50" cy="50" r="48" fill="currentColor" className="text-primary/12" />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-primary/25"
          />

          {/* 头部 */}
          <circle cx="50" cy="37" r="15" fill="currentColor" className="text-primary/55" />

          {/* 身体 */}
          <path
            d="M28 70 Q28 51 50 49 Q72 51 72 70 Z"
            fill="currentColor"
            className="text-primary/45"
          />

          {/* 眼睛 */}
          <circle cx="44" cy="35" r="2.5" fill="white" />
          <circle cx="56" cy="35" r="2.5" fill="white" />

          {/* 嘴部：说话时椭圆，安静时弧线 */}
          {speaking ? (
            <ellipse cx="50" cy="42" rx="4.5" ry="3.5" fill="white" opacity="0.85" />
          ) : (
            <path
              d="M45 41 Q50 46 55 41"
              fill="none"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>

      {/* 状态文字 */}
      <p
        className={`text-sm font-medium transition-colors ${
          speaking ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {speaking ? "AI 正在说话..." : "准备聆听"}
      </p>
    </div>
  );
}

/* ============================================================
   声波柱状条（CSS 动画）
   ============================================================ */
function SoundWaveBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1 h-6">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-primary transition-all duration-200"
          style={
            active
              ? {
                  height: "100%",
                  animation: `soundwave-bar 0.6s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.12}s`,
                }
              : { height: "20%", opacity: 0.3 }
          }
        />
      ))}
    </div>
  );
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

  // ---- 页面状态 ----
  const [initializing, setInitializing] = useState(true); // 加载开场白中
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [turnCount, setTurnCount] = useState(0);
  const [showGoalModal, setShowGoalModal] = useState(false);

  // ---- 会话 refs ----
  const turnsRef = useRef<TurnRecord[]>([]);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);

  // ---- TTS：朗读英文文本 ----
  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        alert("您的浏览器不支持语音合成");
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;

      utterance.onstart = () => setAiSpeaking(true);
      utterance.onend = () => {
        setAiSpeaking(false);
        resolve();
      };
      utterance.onerror = (e) => {
        setAiSpeaking(false);
        if (e.error !== "canceled" && e.error !== "interrupted") {
          console.error("TTS error:", e.error);
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  // ---- 页面加载：启动摄像头 + 调用开场白 API ----
  useEffect(() => {
    if (!task || startedRef.current) return;
    startedRef.current = true;

    const init = async () => {
      setInitializing(true);
      try {
        // 1. 启动摄像头 + 麦克风
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480, facingMode: "user" },
              audio: true,
            });
            cameraStreamRef.current = stream;
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          } catch (mediaErr: any) {
            alert("无法访问摄像头或麦克风: " + (mediaErr.message ?? String(mediaErr)));
          }
        }

        // 2. 调用开场白
        const res = await fetch(`${API_URL}/api/chat/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scene_label: task.scene_label,
            roles: task.roles,
            goal: task.goal,
            evaluation_criteria: task.evaluation_criteria || "",
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "Unknown");
          throw new Error(`开场白请求失败 (${res.status}): ${detail}`);
        }
        const data = (await res.json()) as { ai_text: string };

        if (data.ai_text) {
          await speakText(data.ai_text);
        }
      } catch (err: any) {
        alert("初始化失败: " + (err.message ?? String(err)));
      } finally {
        setInitializing(false);
      }
    };

    init();

    return () => {
      window.speechSynthesis?.cancel();
    };
  }, [task, speakText]);

  // ---- 组件卸载时清理媒体流 ----
  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ---- 开始录音 ----
  const startRecording = useCallback(async () => {
    if (aiSpeaking || uploading || recording) return;

    try {
      // 优先复用已有 stream 的音频轨道
      let audioStream: MediaStream;
      const existingAudioTrack = cameraStreamRef.current
        ?.getAudioTracks()
        .find((t) => t.readyState === "live");

      if (existingAudioTrack) {
        audioStream = new MediaStream([existingAudioTrack]);
      } else {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(audioStream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // 如果是单独获取的音频流，用完释放
        if (!existingAudioTrack) {
          audioStream.getTracks().forEach((t) => t.stop());
        }

        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];

        setUploading(true);
        try {
          // Step 1: 上传音频
          const form = new FormData();
          form.append("file", blob, `recording-${Date.now()}.webm`);
          const uploadRes = await fetch(`${API_URL}/api/upload/audio`, {
            method: "POST",
            body: form,
          });
          if (!uploadRes.ok) {
            const detail = await uploadRes.text().catch(() => "Unknown");
            throw new Error(`音频上传失败 (${uploadRes.status}): ${detail}`);
          }
          const { audio_url } = (await uploadRes.json()) as { audio_url: string };

          if (!audio_url) {
            alert("音频上传失败，未获取到音频地址");
            return;
          }

          // Step 2: 发送对话轮次
          // 从 localStorage 重新读取 task
          let taskId = 0;
          let sceneLabel = "";
          let rolesVal = "";
          try {
            const raw = localStorage.getItem("currentTask");
            if (raw) {
              const t = JSON.parse(raw);
              taskId = parseInt(String(t.id ?? t.scenario_id ?? 0), 10);
              sceneLabel = t.scene_label || "";
              rolesVal = t.roles || "";
            }
          } catch { /* ignore */ }

          console.log("[attempt1] task_id:", taskId, "scene:", sceneLabel);

          if (isNaN(taskId) || taskId < 0) {
            alert("任务数据缺失，请重新生成任务");
            return;
          }

          const chatRes = await fetch(`${API_URL}/api/chat/turn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task_id: taskId,
              audio_url,
              scene_label: sceneLabel,
              roles: rolesVal,
              conversation_history: turnsRef.current.map((t) => ({
                role: "user",
                text: t.user_text || "",
              })),
            }),
          });

          // 错误处理：区分不同失败原因
          if (!chatRes.ok) {
            const errData = await chatRes.json().catch(() => ({}));
            const code = errData.error || "";
            const msg: Record<string, string> = {
              invalid_audio: "音频文件无效或已过期，请重新录制",
              empty_audio: "未检测到语音，请大声说话或检查麦克风",
              transcription_failed: "语音识别服务异常，请稍后重试",
              upload_failed: "音频上传失败，请检查网络后重试",
              audio_unclear: "语音未能识别，请大声重新说一次",
            };
            alert(msg[code] || errData.message || "发生未知错误，请重试");
            return;
          }

          const chatData = (await chatRes.json()) as { ai_text: string; user_text?: string };

          // Step 3: 记录轮次
          turnsRef.current.push({
            user_audio_url: audio_url,
            ai_text: chatData.ai_text || "",
            user_text: chatData.user_text || "",
          });
          setTurnCount((n) => n + 1);

          // Step 4: TTS 朗读 AI 回复
          if (chatData.ai_text) {
            await speakText(chatData.ai_text);
          }
        } catch (err: any) {
          alert(err.message ?? String(err));
        } finally {
          setUploading(false);
        }
      };

      recorder.start(100);
      setRecording(true);
    } catch (err: any) {
      alert("无法开始录音: " + (err.message ?? String(err)));
    }
  }, [aiSpeaking, uploading, recording, task?.id ?? task?.scenario_id, speakText]);

  // ---- 停止录音 ----
  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  // ---- 键盘事件：空格键按住说话 ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !e.repeat &&
        !aiSpeaking &&
        !uploading &&
        !recording
      ) {
        e.preventDefault();
        startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && recording) {
        e.preventDefault();
        stopRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [aiSpeaking, uploading, recording, startRecording, stopRecording]);

  // ---- 提交诊断 ----
  const handleSubmit = async () => {
    if (turnsRef.current.length === 0) {
      setError("请至少进行一次对话后再提交诊断");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      // 使用用户的 ASR 转写文本（而非 AI 回复）作为诊断输入
      const userTexts = turnsRef.current.map((t) => t.user_text).filter(Boolean);
      const fullText = userTexts.join("\n");

      if (!fullText.trim()) {
        const confirmed = window.confirm(
          "未检测到有效语音，是否仍要提交？\n\n提交后将显示\"无有效语音内容\"的诊断结果。"
        );
        if (!confirmed) {
          setSubmitting(false);
          return;
        }
      }

      const rawId = task?.id ?? task?.scenario_id;
      const taskId = parseInt(String(rawId ?? ""), 10);
      const res = await fetch(`${API_URL}/api/attempt1/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: isNaN(taskId) ? 0 : taskId,
          turns: turnsRef.current,
          attempt_text: fullText,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "Unknown");
        throw new Error(`提交失败 (${res.status}): ${detail}`);
      }
      const data = await res.json();

      // 处理后端返回的"无有效语音"错误
      if (data.error === "no_voice") {
        alert(data.message || "未检测到有效语音，请重新尝试");
        setSubmitting(false);
        return;
      }

      // 持久化诊断结果 + 完整对话文本
      localStorage.setItem("diagnosis", JSON.stringify(data));
      localStorage.setItem("attempt1_conversation", JSON.stringify(fullText));
      localStorage.setItem("attempt1_text", fullText);
      localStorage.setItem("attempt1_full_text", fullText);
      router.push("/diagnosis");
    } catch (err: any) {
      const msg = err.message ?? String(err);
      setError(msg);
      alert("诊断提交失败: " + msg);
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
    <div
      className="mx-auto flex max-w-5xl flex-col gap-3"
      style={{ minHeight: "calc(100vh - 120px)" }}
    >
      {/* ---- 顶部任务卡片 ---- */}
      <div className="shrink-0 rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {task.scene_label}
          </span>
          <span className="text-xs text-muted-foreground">
            已完成 {turnCount} 轮对话
          </span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <span className="text-muted-foreground">你的角色: </span>
            <span className="font-medium text-card-foreground">
              {user.split("——")[0]?.trim() ?? user}
            </span>
          </div>
          <div className="min-w-0">
            <span className="text-muted-foreground">AI 角色: </span>
            <span className="font-medium text-card-foreground">
              {ai.split("——")[0]?.trim() ?? ai}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground shrink-0">交际目标: </span>
              <button onClick={() => setShowGoalModal(true)} className="text-xs text-primary hover:underline shrink-0">展开</button>
            </div>
            <span className="font-medium text-card-foreground line-clamp-1">
              {task.goal}
            </span>
          </div>
        </div>

        {/* Goal Modal */}
        {showGoalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowGoalModal(false)}>
            <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-card-foreground">交际目标</h3>
                <button onClick={() => setShowGoalModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
              </div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-card-foreground">{task.goal}</p>
            </div>
          </div>
        )}
      </div>

      {/* ---- 左右分屏主区域 ---- */}
      <div className="flex flex-1 gap-4 min-h-0" style={{ maxHeight: "50vh" }}>
        {/* 左：摄像头实时画面 */}
        <div className="flex-1 rounded-xl border border-border bg-black overflow-hidden relative flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!cameraStreamRef.current && !initializing && (
            <p className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
              摄像头未开启
            </p>
          )}

          {/* 状态指示器 + 波形 */}
          {recording && (
            <>
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-destructive/85 px-3 py-1.5 backdrop-blur-sm">
                <span className="size-2 animate-pulse rounded-full bg-white" />
                <span className="text-xs text-white font-medium">录音中</span>
              </div>
              <div className="absolute bottom-3 left-3 right-3">
                <RecordingWaveform stream={cameraStreamRef.current} isRecording={true} />
              </div>
            </>
          )}
          {uploading && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-primary/85 px-3 py-1.5 backdrop-blur-sm">
              <svg
                className="size-3 animate-spin text-white"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="opacity-25"
                />
                <path
                  d="M4 12a8 8 0 018-8"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="opacity-75"
                />
              </svg>
              <span className="text-xs text-white font-medium">上传中...</span>
            </div>
          )}
        </div>

        {/* 右：AI 角色图标 + 声波动画 */}
        <div className="flex-1 rounded-xl border border-border bg-card flex flex-col items-center justify-center gap-6 p-8">
          <AiAvatar speaking={aiSpeaking} />
          <SoundWaveBars active={aiSpeaking} />

          {initializing && (
            <p className="text-sm text-muted-foreground animate-pulse">
              正在准备开场白...
            </p>
          )}
        </div>
      </div>

      {/* ---- 底部操作区 ---- */}
      <div className="shrink-0 rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        {/* 按住说话按钮 */}
        <div className="flex items-center justify-center">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              startRecording();
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              stopRecording();
            }}
            onMouseLeave={() => {
              if (recording) stopRecording();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              startRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopRecording();
            }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={aiSpeaking || uploading || initializing}
            className={`select-none rounded-full px-10 py-4 text-sm font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-none ${
              recording
                ? "bg-destructive text-destructive-foreground scale-105 shadow-lg shadow-destructive/30"
                : "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg"
            }`}
          >
            {recording
              ? "松开停止"
              : uploading
                ? "上传中..."
                : "按住说话"}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          按住按钮 或 按住
          <kbd className="mx-0.5 rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono">
            空格键
          </kbd>
          开始录音，松开后自动上传并获取 AI 回复
        </p>

        {/* 提交按钮区域 */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            对话完成后（已进行 {turnCount} 轮），点击提交获取诊断
          </p>
          <Button
            onClick={handleSubmit}
            disabled={submitting || turnCount === 0}
          >
            {submitting ? "提交中..." : "提交并查看诊断"}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* ---- 全局 keyframes 注入 ---- */}
      <style jsx global>{`
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        @keyframes soundwave-bar {
          0% {
            height: 4px;
          }
          100% {
            height: 100%;
          }
        }
      `}</style>
    </div>
  );
}
