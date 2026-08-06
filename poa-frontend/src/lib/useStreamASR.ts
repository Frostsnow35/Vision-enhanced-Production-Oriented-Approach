"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { BASE_URL } from "./api";

/**
 * 构建 WebSocket URL（从 REST API BASE_URL 推导）。
 * http:// → ws:// , https:// → wss://
 */
function wsUrl(path: string): string {
  const base = BASE_URL.replace(/^http/, "ws");
  return `${base}${path}`;
}

const TARGET_RATE = 16000; // 火山流式 ASR 固定采样率
const ACCUM_SAMPLES = 3200; // 每 ~200ms（16000Hz）发一包，符合火山单包 100~200ms 建议
const STOP_TIMEOUT_MS = 12000; // 停止后等待最终结果的最长时间（与后端 12s 对齐）

/**
 * 将 Int16 数据线性插值重采样到 16000Hz（处理浏览器不支持 16k AudioContext 的情况）。
 */
function resampleTo16k(data: Int16Array, fromRate: number): Int16Array {
  if (fromRate === TARGET_RATE) return data;
  const ratio = TARGET_RATE / fromRate;
  const outLen = Math.max(1, Math.round(data.length * ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const i0 = Math.min(idx, data.length - 1);
    const i1 = Math.min(idx + 1, data.length - 1);
    const v = data[i0] * (1 - frac) + data[i1] * frac;
    out[i] = v < 0 ? Math.max(-32768, Math.round(v)) : Math.min(32767, Math.round(v));
  }
  return out;
}

/**
 * 火山引擎流式语音识别 Hook（WebSocket 代理模式，边说边出字幕）。
 *
 * 用法：
 *   const { start, stop, interimText, isRecording, error } = useStreamASR();
 *   start();                 // 开始录音 + 流式 ASR（异步，内部建连）
 *   const text = await stop(); // 停止录音，返回最终转写文本
 *
 * 链路：
 *   麦克风 → AudioContext(16kHz) → Int16 PCM → 累积200ms → WebSocket
 *   → 后端代理 → 火山流式 ASR → 后端 → 前端（interim/final JSON）
 *
 * 健壮性设计：
 * - stop() 会先等待 start() 完成建连（避免快速短按导致 ASR 失效）
 * - stop() 前冲刷累积缓冲中残余音频（避免最后一个词丢失）
 * - 停止协议：发 {"action":"stop"} 文本帧，后端回传 {"type":"final"} 后再收尾
 */
export function useStreamASR() {
  // ---- 状态 ----
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");

  // ---- Refs ----
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const finalTextRef = useRef("");
  const interimRef = useRef("");
  const pcmAccumRef = useRef<Int16Array[]>([]);
  const pcmAccumLenRef = useRef(0);
  const closedRef = useRef(false);
  const resolveStopRef = useRef<((text: string) => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotFinalRef = useRef(false);
  const chunkSentCount = useRef(0);     // 已发送到后端的 PCM 块计数
  const chunkVerifyDone = useRef(false); // 前 3 块验证是否已完成

  // ---- 清理 ----
  const cleanup = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (silentGainRef.current) {
      try { silentGainRef.current.disconnect(); } catch {}
      silentGainRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(1000); } catch {}
      wsRef.current = null;
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  // ---- 冲刷累积缓冲 ----
  const flushAccum = useCallback((ws: WebSocket | null): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pcmAccumLenRef.current <= 0) return;
    const total = pcmAccumLenRef.current;
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of pcmAccumRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      ws.send(merged.buffer);
    } catch {
      // ignore
    }
    pcmAccumRef.current = [];
    pcmAccumLenRef.current = 0;
  }, []);

  // ---- 开始 ----
  const start = useCallback(async () => {
    // 若上一次会话的 WebSocket 仍存活，先关闭（防止重复建连）
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.close(1000); } catch {}
    }

    setError("");
    setInterimText("");
    interimRef.current = "";
    finalTextRef.current = "";
    pcmAccumRef.current = [];
    pcmAccumLenRef.current = 0;
    closedRef.current = false;
    gotFinalRef.current = false;
    resolveStopRef.current = null;

    const p = (async () => {
      // 1. 获取麦克风
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streamRef.current = stream;
      } catch {
        setError("无法访问麦克风，请检查权限设置");
        return;
      }

      // 2. 创建 AudioContext（尽力请求 16kHz）
      let audioCtx: AudioContext;
      try {
        audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
        audioCtxRef.current = audioCtx;
      } catch {
        setError("浏览器不支持音频处理");
        return;
      }
      const actualRate = audioCtx.sampleRate || TARGET_RATE;

      // 3. 建立 WebSocket 连接（带超时 + 1 次自动重试）
      const wsUrlStr = wsUrl("/api/chat/asr-stream");
      let ws: WebSocket | null = null;
      let wsConnected = false;

      const connectWs = (): Promise<WebSocket> =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(wsUrlStr);
          socket.binaryType = "blob";
          const timeout = setTimeout(() => {
            if (!wsConnected) {
              try { socket.close(); } catch {}
              reject(new Error(`WebSocket 连接超时（>8s）: ${wsUrlStr}`));
            }
          }, 8000);
          socket.onopen = () => {
            clearTimeout(timeout);
            wsConnected = true;
            resolve(socket);
          };
          socket.onerror = () => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket 连接失败: ${wsUrlStr}`));
          };
        });

      // 首次尝试，失败后自动重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          ws = await connectWs();
          break;
        } catch (connErr: any) {
          if (attempt === 0) {
            console.warn(`[ASR-Stream] 第1次连接失败，1秒后重试...`, connErr?.message);
            await new Promise(r => setTimeout(r, 1000));
          } else {
            setError(`语音识别连接失败，请检查网络或开启代理后刷新页面重试`);
            return;
          }
        }
      }

      if (!ws) return;
      wsRef.current = ws;

      // 连接成功：启动音频处理管线（原 ws.onopen 逻辑，因重试后 ws 已 open 故直接执行）
      console.log("[ASR-Stream] WebSocket 已连接 →", wsUrlStr);
      {
        // Chrome 自动播放策略：无手势时 context 可能 suspended，显式恢复
        if (audioCtx.state === "suspended") {
          try { await audioCtx.resume(); } catch { /* ignore */ }
        }

        const source = audioCtx.createMediaStreamSource(stream);

        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        silentGainRef.current = silentGain;

        processor.onaudioprocess = (e) => {
          if (closedRef.current) return;
          const input = e.inputBuffer.getChannelData(0);

          // Float32 [-1, 1] → Int16（AudioContext 实际采样率下）
          const raw = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const clamped = Math.max(-1, Math.min(1, input[i]));
            raw[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
          }

          // 重采样到 16kHz（若浏览器实际采样率不同）
          const int16 = resampleTo16k(raw, actualRate);

          // 累积到 ~200ms 再发送，符合火山单包大小建议
          pcmAccumRef.current.push(int16);
          pcmAccumLenRef.current += int16.length;

          if (pcmAccumLenRef.current >= ACCUM_SAMPLES && ws.readyState === WebSocket.OPEN) {
            const total = pcmAccumLenRef.current;
            const merged = new Int16Array(total);
            let offset = 0;
            for (const chunk of pcmAccumRef.current) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            try {
              // 前 3 块打印 PCM 诊断：确认麦克风是否真的在采音
              if (!chunkVerifyDone.current && chunkSentCount.current < 3) {
                let _min = 32767, _max = -32768, _nonzero = 0;
                for (let _i = 0; _i < merged.length; _i++) {
                  const _v = merged[_i];
                  if (_v !== 0) _nonzero++;
                  if (_v < _min) _min = _v;
                  if (_v > _max) _max = _v;
                }
                const ratio = ((_nonzero / merged.length) * 100).toFixed(1);
                console.log(
                  `[ASR-Stream→] PCM块 #${chunkSentCount.current + 1} samples=${merged.length} ` +
                  `min=${_min} max=${_max} nonzero=${_nonzero}(${ratio}%)`
                );
                chunkSentCount.current++;
                if (chunkSentCount.current >= 3) chunkVerifyDone.current = true;
              }
              ws.send(merged.buffer);
            } catch {
              // ignore send errors
            }
            pcmAccumRef.current = [];
            pcmAccumLenRef.current = 0;
          }
        };

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
        setIsRecording(true);
      }

      ws.onmessage = (event) => {
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          console.warn("[ASR-Stream] 收到非 JSON 消息:", typeof event.data);
          return;
        }
        if (data.type === "interim") {
          if (data.text !== interimRef.current) {
            interimRef.current = data.text || "";
            setInterimText(data.text || "");
            console.log("[ASR-Stream] interim:", data.text);
          }
        } else if (data.type === "final") {
          finalTextRef.current = data.text || "";
          gotFinalRef.current = true;
          console.log("[ASR-Stream] final:", data.text);
          if (resolveStopRef.current) {
            resolveStopRef.current(finalTextRef.current);
            resolveStopRef.current = null;
          }
        } else if (data.type === "error") {
          setError(data.message || "ASR 错误");
        }
      };

      ws.onerror = (e) => {
        const msg = "流式识别连接失败，请检查网络";
        console.error("[ASR-Stream] WebSocket 连接错误:", msg, e);
        setError(msg);
      };

      ws.onclose = (e) => {
        console.log(`[ASR-Stream] WebSocket 关闭 code=${e.code} reason=${e.reason}`);
        setIsRecording(false);
        // 连接提前关闭且未收到 final：用当前 interim 兜底，避免 stop() 永久挂起
        if (resolveStopRef.current) {
          resolveStopRef.current(interimRef.current || "");
          resolveStopRef.current = null;
        }
      };
    })();

    startPromiseRef.current = p;
    await p;
  }, []);

  // ---- 停止 ----
  const stop = useCallback(async (): Promise<string> => {
    if (closedRef.current) return finalTextRef.current || interimRef.current || "";
    closedRef.current = true;

    // 等待 start() 完成建连（防止快速短按：stop 早于 ws 建立）
    if (startPromiseRef.current) {
      try { await startPromiseRef.current; } catch { /* ignore */ }
    }

    // 冲刷累积缓冲中残余音频，避免最后一个词丢失
    flushAccum(wsRef.current);

    // 断开音频处理链并释放麦克风
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (silentGainRef.current) {
      try { silentGainRef.current.disconnect(); } catch {}
      silentGainRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const ws = wsRef.current;

    // 先发 stop 控制消息，让后端完成收尾并回传 final，再关闭连接
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: "stop" }));
        console.log("[ASR-Stream] stop() → 已发送 stop 指令");
      } catch {
        // ignore
      }
    } else {
      // 连接未建立成功（如无 ASR 配置 / 麦克风被拒），直接返回空
      console.warn(`[ASR-Stream] stop() → WebSocket 未连接, state=${ws?.readyState}`);
      setIsRecording(false);
      setInterimText("");
      return interimRef.current || "";
    }

    // 等待 final 消息（onmessage 里 resolve），超时兜底
    if (!gotFinalRef.current) {
      console.log("[ASR-Stream] stop() → 等待 final...");
      finalTextRef.current = await new Promise<string>((resolve) => {
        resolveStopRef.current = resolve;
        stopTimerRef.current = setTimeout(() => {
          if (resolveStopRef.current) {
            const fallback = interimRef.current || "";
            console.warn(`[ASR-Stream] stop() → 超时(${STOP_TIMEOUT_MS}ms)兜底, interim='${fallback}'`);
            resolveStopRef.current(fallback);
            resolveStopRef.current = null;
          }
        }, STOP_TIMEOUT_MS);
      });
    }

    const text = finalTextRef.current || interimRef.current || "";
    console.log(`[ASR-Stream] stop() → 最终文本='${text}'`);
    setIsRecording(false);
    setInterimText("");
    return text.trim();
  }, [flushAccum]);

  return {
    start,
    stop,
    interimText,
    isRecording,
    error,
  } as const;
}
