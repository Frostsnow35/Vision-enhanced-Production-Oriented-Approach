"use client";

import { useRef, useState, useCallback } from "react";

// 浏览器 Web Speech API 类型声明（TS 默认不包含）
declare global {
  interface Window {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  }
}

// ---- Hook ----
/**
 * 浏览器原生语音识别 Hook（Web Speech API）。
 * 与 MediaRecorder 并行工作：录音同时进行语音识别，实现"边说边出字幕"。
 * 仅在 Chrome / Edge 中可用（Firefox 不支持 SpeechRecognition）。
 * 
 * 用法：
 *   const { start, stop, interimTranscript, finalTranscript, supported } = useBrowserASR();
 *   // 录音开始时
 *   start("en-US");
 *   // 录音停止时
 *   const text = stop(); // 拿到最终转写文本
 */
export function useBrowserASR(lang: string = "en-US") {
  const recRef = useRef<any>(null);
  const interimRef = useRef("");
  const finalRef = useRef("");
  // 累积 ref：保存 final（已完成）+ 当前 interim 的最新组合文本，
  // 作为 stop() 时 onresult 尚未触发的兜底，避免丢字。
  const cumulativeRef = useRef("");

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState("");

  // 检测支持性（仅在首次渲染时执行，避免 SSR 崩溃）
  const supported = (() => {
    if (typeof window === "undefined") return false;
    // iOS Safari 不支持 SpeechRecognition（需 >= 14.5 但体验极差，直接禁用）
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return false;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!Ctor;
  })();

  const start = useCallback((overrideLang?: string) => {
    if (!supported) {
      setError("浏览器不支持语音识别，请使用 Chrome / Edge 或直接输入文字");
      return;
    }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec: any = new Ctor();
    rec.lang = overrideLang || lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    interimRef.current = "";
    finalRef.current = "";
    cumulativeRef.current = "";
    setInterimTranscript("");
    setFinalTranscript("");
    setError("");

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      interimRef.current = interim;
      setInterimTranscript(interim);
      // 累积 ref：final（已确认）+ 当前 interim（最新可能文本）
      cumulativeRef.current = finalRef.current + interim;
    };

    rec.onerror = (e: any) => {
      const err = e;
      // "no-speech" / "aborted" 是正常结束，不设 error
      if (err.error === "no-speech" || err.error === "aborted") {
        return;
      }
      console.warn("[BrowserASR] error:", err.error, err.message);
      // "not-allowed" 表示用户拒绝了麦克风权限
      if (err.error === "not-allowed") {
        setError("麦克风权限被拒绝，请在浏览器设置中允许麦克风权限后刷新页面");
      } else if (err.error === "network") {
        setError("语音识别需要联网，请检查网络连接");
      } else {
        // audio-capture / service-not-allowed / bad-grammar / language-not-supported
        setError(`语音识别不可用: ${err.error}`);
      }
    };

    rec.onend = () => {
      setIsListening(false);
    };

    try {
      rec.start();
      recRef.current = rec;
      setIsListening(true);
    } catch (e: any) {
      setError(`启动语音识别失败: ${e.message || e}`);
      console.error("[BrowserASR] start failed:", e);
    }
  }, [supported, lang]);

  /**
   * 停止语音识别，返回最终的完整转写文本。
   * 优先 final（含标点），其次 cumulative（累积），最后 interim。
   * 注意：rec.stop() 是异步的，onresult 可能在 stop() 返回后才触发，
   * 因此 cumulativeRef 作为安全网，确保不会因时序丢失文本。
   */
  const stop = useCallback((): string => {
    const rec = recRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* ignore */ }
      recRef.current = null;
    }
    setIsListening(false);
    const text = (finalRef.current || cumulativeRef.current || interimRef.current || "").trim();
    setFinalTranscript(text);
    return text;
  }, []);

  /** 中止（不返回结果） */
  const abort = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try { rec.abort(); } catch { /* ignore */ }
      recRef.current = null;
    }
    setIsListening(false);
  }, []);

  /** 从 ref 读取最终转录文本（同步，不依赖 React 状态）。
   * 优先 final（含标点），其次 cumulative（累积），最后 interim。 */
  const getText = useCallback(() => (finalRef.current || cumulativeRef.current || interimRef.current || "").trim(), []);

  return {
    supported,
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
    abort,
    getText,
  } as const;
}
