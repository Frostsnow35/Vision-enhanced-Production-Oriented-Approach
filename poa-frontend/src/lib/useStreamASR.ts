"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { BASE_URL, PRODUCTION_BACKEND } from "./api";

/**
 * 构建 WebSocket URL（从 REST API BASE_URL 推导）。
 * http:// → ws:// , https:// → wss://
 * 生产环境（Vercel rewrite 模式，BASE_URL=""）回退到直连 Railway。
 */
function wsUrl(path: string): string {
  const base = BASE_URL || PRODUCTION_BACKEND;
  return `${base.replace(/^http/, "ws")}${path}`;
}

const TARGET_RATE = 16000;
const ACCUM_SAMPLES = 3200;
const STOP_TIMEOUT_MS = 12000;

// ============================================================
// 火山流式 ASR 二进制协议常量（与后端 asr_service.py 保持一致）
// ============================================================
const PROTO_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const MSG_FULL_REQUEST = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const FLAG_POS_SEQ = 0b0001;
const FLAG_NEG_SEQ = 0b0011;
const FLAG_NO_SEQ = 0b0000;
const SERIAL_JSON = 0b0001;
const SERIAL_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;

/** 检查浏览器是否支持 CompressionStream / DecompressionStream API（gzip 格式）。 */
function _supportsCompressionStreams(): boolean {
  try {
    return (
      typeof CompressionStream !== "undefined" &&
      typeof DecompressionStream !== "undefined"
    );
  } catch {
    return false;
  }
}

// ---- GZIP 辅助 ----

async function _gzip(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  w.write(data as Uint8Array<ArrayBuffer>);
  w.close();
  const r = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total) as Uint8Array<ArrayBuffer>;
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function _gunzip(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(data as Uint8Array<ArrayBuffer>);
  w.close();
  const r = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total) as Uint8Array<ArrayBuffer>;
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---- 二进制帧构建 ----

function _i32be(v: number): Uint8Array {
  const b = new ArrayBuffer(4);
  new DataView(b).setInt32(0, v, false);
  return new Uint8Array(b);
}

function _u32be(v: number): Uint8Array {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, v, false);
  return new Uint8Array(b);
}

function _header(msgType: number, flags: number, serial: number, comp: number): Uint8Array {
  return new Uint8Array([
    (PROTO_VERSION << 4) | HEADER_SIZE,
    (msgType << 4) | flags,
    (serial << 4) | comp,
    0x00,
  ]);
}

async function _buildStartFrame(config: object, seq: number): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(config));
  const payload = await _gzip(json);
  const hdr = _header(MSG_FULL_REQUEST, FLAG_POS_SEQ, SERIAL_JSON, COMPRESS_GZIP);
  const frame = new Uint8Array(4 + 4 + 4 + payload.length);
  frame.set(hdr, 0);
  frame.set(_i32be(seq), 4);
  frame.set(_u32be(payload.length), 8);
  frame.set(payload, 12);
  return frame;
}

async function _buildAudioFrame(pcm: Uint8Array, seq: number, last = false): Promise<Uint8Array> {
  const payload = await _gzip(pcm);
  const flags = last ? FLAG_NEG_SEQ : FLAG_POS_SEQ;
  const seqVal = last ? -seq : seq;
  const hdr = _header(MSG_AUDIO_ONLY, flags, SERIAL_NONE, COMPRESS_GZIP);
  const frame = new Uint8Array(4 + 4 + 4 + payload.length);
  frame.set(hdr, 0);
  frame.set(_i32be(seqVal), 4);
  frame.set(_u32be(payload.length), 8);
  frame.set(payload, 12);
  return frame;
}

// ---- 火山响应解析 ----

interface ParsedResponse {
  text: string;
  isFinal: boolean;
}

async function _parseVolcanoResponse(msg: ArrayBuffer): Promise<ParsedResponse> {
  const bytes = new Uint8Array(msg);
  if (bytes.length < 8) return { text: "", isFinal: false };

  const messageType = bytes[1] >> 4;
  const flags = bytes[1] & 0x0f;
  const compression = bytes[2] & 0x0f;

  const seqOffset = flags !== FLAG_NO_SEQ ? 4 : 0;
  const psStart = 4 + seqOffset;
  const payloadStart = 8 + seqOffset;

  if (bytes.length < payloadStart) return { text: "", isFinal: false };

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const payloadSize = dv.getUint32(psStart, false);
  if (payloadSize > 64 * 1024 * 1024) return { text: "", isFinal: false };
  if (bytes.length < payloadStart + payloadSize) return { text: "", isFinal: false };

  let payload = bytes.slice(payloadStart, payloadStart + payloadSize);

  if (compression === COMPRESS_GZIP && payload.length > 0) {
    try {
      payload = await _gunzip(payload);
    } catch {
      // gzip decompress failed, try parsing raw
    }
  }

  let body: Record<string, any> = {};
  try {
    body = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    // JSON parse failed
  }

  // SERVER_ERROR_RESPONSE (0b1111)
  if (messageType === 0b1111) {
    console.warn("[ASR-Direct] 火山返回错误:", body);
    return { text: "", isFinal: true };
  }

  let text = "";
  const result = body?.result;
  if (result) {
    text = (result.text || "").trim();
    if (!text) {
      const utterances: Array<{ text?: string }> = result.utterances || [];
      text = utterances.map((u) => u.text || "").join(" ").trim();
    }
  }

  // 最终结果：服务端 flags == 0b0011
  const isFinal = flags === 0b0011;

  if (text) {
    console.log(`[ASR-Direct←] ${isFinal ? "final" : "interim"}: ${text.slice(0, 80)}`);
  }

  return { text, isFinal };
}

// ============================================================
// 重采样辅助
// ============================================================

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

// ============================================================
// 主 Hook
// ============================================================

/**
 * 火山引擎流式语音识别 Hook。
 *
 * 连接策略（智能切换）：
 *   1. 优先尝试「直连模式」：前端浏览器直连 wss://openspeech.bytedance.com
 *      （鉴权通过 /api/asr/token 获取临时 JWT，URL 参数传递）
 *   2. 直连失败则回退到「代理模式」：前端 → Railway 后端 → 火山 ASR
 *
 * 直连模式优势：浏览器与火山 ASR 同在国内，不经过 Railway（美国），
 * 避免跨境 WebSocket 被 ISP 阻断。
 *
 * 用法：
 *   const { start, stop, interimText, isRecording, error } = useStreamASR();
 *   start();
 *   const text = await stop();
 */
export function useStreamASR() {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");

  // Refs
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
  const chunkSentCount = useRef(0);
  const chunkVerifyDone = useRef(false);
  const isDirectRef = useRef(false); // 当前是否为直连模式
  const seqRef = useRef(0); // 直连模式的帧序号

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

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  // ---- 冲刷累积缓冲 ----
  const flushAccum = useCallback((ws: WebSocket | null, direct: boolean): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pcmAccumLenRef.current <= 0) return;
    const total = pcmAccumLenRef.current;
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of pcmAccumRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    if (direct) {
      // 直连模式：发送二进制帧（fire-and-forget，gzip 异步）
      const pcmBytes = new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
      seqRef.current++;
      _buildAudioFrame(pcmBytes, seqRef.current, false)
        .then((frame) => {
          try { ws.send(frame.buffer); } catch {}
        })
        .catch(() => {});
    } else {
      // 代理模式：发送原始 PCM
      try {
        ws.send(merged.buffer);
      } catch {}
    }
    pcmAccumRef.current = [];
    pcmAccumLenRef.current = 0;
  }, []);

  // ---- 发送 PCM 数据（直连模式用异步 gzip 构建帧） ----
  const sendPcmDirect = useCallback((ws: WebSocket, merged: Int16Array) => {
    const pcmBytes = new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
    seqRef.current++;
    _buildAudioFrame(pcmBytes, seqRef.current, false)
      .then((frame) => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(frame.buffer); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const sendPcmProxy = useCallback((ws: WebSocket, merged: Int16Array) => {
    try {
      ws.send(merged.buffer);
    } catch {}
  }, []);

  // ---- 开始 ----
  const start = useCallback(async () => {
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
    chunkSentCount.current = 0;
    chunkVerifyDone.current = false;
    seqRef.current = 0;

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

      // 2. AudioContext
      let audioCtx: AudioContext;
      try {
        audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
        audioCtxRef.current = audioCtx;
      } catch {
        setError("浏览器不支持音频处理");
        return;
      }
      const actualRate = audioCtx.sampleRate || TARGET_RATE;

      // 3. 尝试直连火山 ASR（绕过 Railway 跨境 WebSocket）
      const canCompress = _supportsCompressionStreams();
      let ws: WebSocket | null = null;
      let directMode = false;

      if (canCompress) {
        try {
          // 3a. 从后端获取 STS Token
          const tokenUrl = `${BASE_URL}/api/chat/asr/token`;
          console.log("[ASR-Direct] 获取 STS Token...", tokenUrl);
          const tokenResp = await fetch(tokenUrl);
          if (!tokenResp.ok) {
            console.warn(`[ASR-Direct] Token 获取失败 HTTP ${tokenResp.status}, 回退代理模式`);
          } else {
            const tokenData = await tokenResp.json();
            const { token: jwt, appid, resource_id, stream_url } = tokenData;
            if (jwt && appid) {
              // 3b. 构建直连 URL（鉴权参数编码在 query string 中）
              const params = new URLSearchParams({
                api_resource_id: resource_id,
                api_app_key: appid,
                api_access_key: `Jwt; ${jwt}`,
              });
              const directUrl = `${stream_url}?${params.toString()}`;
              console.log("[ASR-Direct] 尝试直连火山:", stream_url);

              // 3c. 直连 WebSocket（带超时）
              ws = await new Promise<WebSocket>((resolve, reject) => {
                const socket = new WebSocket(directUrl);
                socket.binaryType = "arraybuffer";
                const timeout = setTimeout(() => {
                  try { socket.close(); } catch {}
                  reject(new Error("直连 WebSocket 超时（>8s）"));
                }, 8000);
                socket.onopen = () => {
                  clearTimeout(timeout);
                  resolve(socket);
                };
                socket.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error("直连 WebSocket 连接失败"));
                };
              });

              // 3d. 发送首帧 FullClientRequest
              const startConfig = {
                user: { uid: "poa_user", platform: "web", sdk_version: "1.0" },
                audio: { format: "pcm", rate: 16000, bits: 16, channel: 1 },
                request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
              };
              seqRef.current = 1;
              const startFrame = await _buildStartFrame(startConfig, 1);
              ws.send(startFrame.buffer);
              console.log("[ASR-Direct] 火山直连成功，首帧已发送");
              directMode = true;
            }
          }
        } catch (e: any) {
          console.warn("[ASR-Direct] 直连失败，回退代理模式:", e?.message || e);
        }
      } else {
        console.log("[ASR-Direct] 浏览器不支持 CompressionStream，跳过直连");
      }

      // 4. 直连失败 → 回退代理模式
      if (!ws) {
        directMode = false;
        const proxyUrl = wsUrl("/api/chat/asr-stream");
        console.log("[ASR-Proxy] 尝试代理模式连接:", proxyUrl);

        const connectProxy = (): Promise<WebSocket> =>
          new Promise((resolve, reject) => {
            const socket = new WebSocket(proxyUrl);
            socket.binaryType = "blob";
            const timeout = setTimeout(() => {
              try { socket.close(); } catch {}
              reject(new Error(`代理 WebSocket 超时（>8s）`));
            }, 8000);
            socket.onopen = () => { clearTimeout(timeout); resolve(socket); };
            socket.onerror = () => { clearTimeout(timeout); reject(new Error("代理 WebSocket 连接失败")); };
          });

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            ws = await connectProxy();
            console.log("[ASR-Proxy] 代理模式连接成功");
            break;
          } catch (e: any) {
            if (attempt === 0) {
              console.warn("[ASR-Proxy] 第1次连接失败，1秒后重试...", e?.message);
              await new Promise((r) => setTimeout(r, 1000));
            } else {
              setError("语音识别连接失败，请检查网络或开启代理后刷新页面重试");
              return;
            }
          }
        }
      }

      if (!ws) return;
      wsRef.current = ws;
      isDirectRef.current = directMode;

      // 5. 设置消息处理（模式不同，解析方式不同）
      if (directMode) {
        ws.onmessage = async (event) => {
          if (!(event.data instanceof ArrayBuffer)) {
            // 火山直连只收二进制帧
            console.warn("[ASR-Direct] 收到非二进制消息");
            return;
          }
          try {
            const parsed = await _parseVolcanoResponse(event.data);
            if (parsed.text && !parsed.isFinal) {
              if (parsed.text !== interimRef.current) {
                interimRef.current = parsed.text;
                setInterimText(parsed.text);
              }
            }
            if (parsed.isFinal) {
              finalTextRef.current = parsed.text;
              gotFinalRef.current = true;
              console.log("[ASR-Direct] final:", parsed.text);
              if (resolveStopRef.current) {
                resolveStopRef.current(parsed.text);
                resolveStopRef.current = null;
              }
            }
          } catch (e) {
            console.warn("[ASR-Direct] 响应解析异常:", e);
          }
        };
      } else {
        // 代理模式的 JSON 消息处理
        ws.onmessage = (event) => {
          let data: any;
          try {
            data = JSON.parse(event.data);
          } catch {
            console.warn("[ASR-Proxy] 收到非 JSON 消息:", typeof event.data);
            return;
          }
          if (data.type === "interim") {
            if (data.text !== interimRef.current) {
              interimRef.current = data.text || "";
              setInterimText(data.text || "");
            }
          } else if (data.type === "final") {
            finalTextRef.current = data.text || "";
            gotFinalRef.current = true;
            if (resolveStopRef.current) {
              resolveStopRef.current(finalTextRef.current);
              resolveStopRef.current = null;
            }
          } else if (data.type === "error") {
            setError(data.message || "ASR 错误");
          }
        };
      }

      ws.onerror = () => {
        console.error("[ASR] WebSocket 连接错误");
        if (!directMode) setError("流式识别连接失败，请检查网络");
      };

      ws.onclose = (e) => {
        console.log(`[ASR] WebSocket 关闭 code=${e.code} reason=${e.reason}`);
        setIsRecording(false);
        if (resolveStopRef.current) {
          resolveStopRef.current(interimRef.current || "");
          resolveStopRef.current = null;
        }
      };

      // 6. 启动音频处理管线
      if (audioCtx.state === "suspended") {
        try { await audioCtx.resume(); } catch {}
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

        const raw = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const clamped = Math.max(-1, Math.min(1, input[i]));
          raw[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
        }

        const int16 = resampleTo16k(raw, actualRate);

        pcmAccumRef.current.push(int16);
        pcmAccumLenRef.current += int16.length;

        if (pcmAccumLenRef.current >= ACCUM_SAMPLES && ws!.readyState === WebSocket.OPEN) {
          const total = pcmAccumLenRef.current;
          const merged = new Int16Array(total);
          let offset = 0;
          for (const chunk of pcmAccumRef.current) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }

          if (directMode) {
            // 直连：异步 gzip + 二进制帧
            sendPcmDirect(ws!, merged);
          } else {
            // 代理：原始 PCM + PCM 诊断
            if (!chunkVerifyDone.current && chunkSentCount.current < 3) {
              let _min = 32767,
                _max = -32768,
                _nonzero = 0;
              for (let _i = 0; _i < merged.length; _i++) {
                const _v = merged[_i];
                if (_v !== 0) _nonzero++;
                if (_v < _min) _min = _v;
                if (_v > _max) _max = _v;
              }
              const ratio = ((_nonzero / merged.length) * 100).toFixed(1);
              console.log(
                `[ASR-Proxy→] PCM块 #${chunkSentCount.current + 1} samples=${merged.length} ` +
                  `min=${_min} max=${_max} nonzero=${_nonzero}(${ratio}%)`
              );
              chunkSentCount.current++;
              if (chunkSentCount.current >= 3) chunkVerifyDone.current = true;
            }
            sendPcmProxy(ws!, merged);
          }

          pcmAccumRef.current = [];
          pcmAccumLenRef.current = 0;
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      setIsRecording(true);
    })();

    startPromiseRef.current = p;
    await p;
  }, [sendPcmDirect, sendPcmProxy]);

  // ---- 停止 ----
  const stop = useCallback(async (): Promise<string> => {
    if (closedRef.current) return finalTextRef.current || interimRef.current || "";
    closedRef.current = true;

    if (startPromiseRef.current) {
      try { await startPromiseRef.current; } catch {}
    }

    const direct = isDirectRef.current;

    // 冲刷残余音频
    flushAccum(wsRef.current, direct);

    // 断开音频链
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

    if (ws && ws.readyState === WebSocket.OPEN) {
      if (direct) {
        // 直连模式：发送空音频结束帧（负 sequence）
        try {
          seqRef.current++;
          const endFrame = await _buildAudioFrame(new Uint8Array(0), seqRef.current, true);
          ws.send(endFrame.buffer);
          console.log("[ASR-Direct] stop() → 已发送结束帧（负包）");
        } catch {
          // ignore
        }
      } else {
        // 代理模式：发送 stop 控制消息
        try {
          ws.send(JSON.stringify({ action: "stop" }));
          console.log("[ASR-Proxy] stop() → 已发送 stop 指令");
        } catch {
          // ignore
        }
      }
    } else {
      console.warn(`[ASR] stop() → WebSocket 未连接, state=${ws?.readyState}`);
      setIsRecording(false);
      setInterimText("");
      return interimRef.current || "";
    }

    // 等待 final
    if (!gotFinalRef.current) {
      console.log("[ASR] stop() → 等待 final...");
      finalTextRef.current = await new Promise<string>((resolve) => {
        resolveStopRef.current = resolve;
        stopTimerRef.current = setTimeout(() => {
          if (resolveStopRef.current) {
            const fallback = interimRef.current || "";
            console.warn(`[ASR] stop() → 超时(${STOP_TIMEOUT_MS}ms)兜底, interim='${fallback}'`);
            resolveStopRef.current(fallback);
            resolveStopRef.current = null;
          }
        }, STOP_TIMEOUT_MS);
      });
    }

    const text = finalTextRef.current || interimRef.current || "";
    console.log(`[ASR] stop() → 最终文本='${text}'`);
    setIsRecording(false);
    setInterimText("");

    // 关闭 WebSocket
    try { ws?.close(1000); } catch {}
    wsRef.current = null;

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
