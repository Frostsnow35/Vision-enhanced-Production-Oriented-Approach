/**
 * 音频播放工具
 * 策略：服务器 TTS 音频优先 → 浏览器 SpeechSynthesis 降级
 */

/**
 * 使用浏览器内置 TTS 朗读英文文本
 * 返回 Promise，朗读完成或取消时 resolve
 */
export function speakWithBrowserTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    // 取消任何正在进行的朗读
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    // 安全网：15秒超时
    const safety = setTimeout(() => {
      window.speechSynthesis.cancel();
      resolve();
    }, 15000);
    utterance.onend = () => { clearTimeout(safety); resolve(); };
    utterance.onerror = () => { clearTimeout(safety); resolve(); };
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * 播放 AI 语音：优先用服务器 TTS 音频 URL，失败/无 URL 时降级浏览器 TTS
 * @param audioUrl 服务器返回的音频 URL（可能为空）
 * @param fallbackText 当音频播放失败时，用浏览器 TTS 朗读此文本
 * @param onStateChange 播放状态变化回调 (isSpeaking: boolean)
 * @returns Promise，播放完成后 resolve
 */
export async function playAiAudio(
  audioUrl: string | undefined | null,
  fallbackText: string,
  onStateChange?: (isPlaying: boolean) => void
): Promise<void> {
  // 策略 1: 尝试播放服务端 TTS 音频
  if (audioUrl) {
    const fullUrl = audioUrl.startsWith("http") ? audioUrl : audioUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(fullUrl);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio load error"));
        audio.play().catch((e) => reject(e));
        // 安全网：30秒超时
        const safety = setTimeout(() => { audio.pause(); resolve(); }, 30000);
        audio.onended = () => { clearTimeout(safety); resolve(); };
        audio.onerror = () => { clearTimeout(safety); reject(new Error("Audio error")); };
      });
      return; // 播放成功
    } catch {
      // 播放失败，降级到浏览器 TTS
      console.warn("[audio] 服务端音频播放失败，降级浏览器 TTS");
    }
  }

  // 策略 2: 浏览器 TTS 降级
  if (fallbackText) {
    onStateChange?.(true);
    await speakWithBrowserTTS(fallbackText);
    onStateChange?.(false);
  }
}
