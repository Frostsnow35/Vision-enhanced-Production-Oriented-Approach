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
      console.warn("[audio] speechSynthesis 不可用");
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    // 取消任何正在进行的朗读
    synth.cancel();
    // 等待 voices 加载（移动端可能需要异步加载）
    const doSpeak = () => {
      let voices = synth.getVoices();
      if (voices.length === 0) {
        console.warn("[audio] speechSynthesis voices 为空，延迟重试");
        setTimeout(() => {
          voices = synth.getVoices();
          const enVoice = voices.find(v => v.lang.startsWith("en")) || voices[0];
          speakUtterance(synth, text, enVoice, resolve);
        }, 200);
      } else {
        const enVoice = voices.find(v => v.lang.startsWith("en"));
        speakUtterance(synth, text, enVoice || undefined, resolve);
      }
    };
    if (synth.getVoices().length > 0) {
      doSpeak();
    } else {
      synth.onvoiceschanged = () => {
        synth.onvoiceschanged = null;
        doSpeak();
      };
      // 安全网：500ms 后无论如何都尝试
      setTimeout(() => {
        if ((synth.onvoiceschanged as any) !== null) {
          synth.onvoiceschanged = null;
          doSpeak();
        }
      }, 500);
    }
  });
}

function speakUtterance(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechSynthesisVoice | undefined,
  resolve: () => void
): void {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  if (voice) utterance.voice = voice;
  console.log(`[audio] 开始朗读 (voice=${voice?.name || "default"}): ${text.slice(0, 60)}...`);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(safety);
    console.log("[audio] 朗读完成");
    resolve();
  };
  utterance.onend = finish;
  utterance.onerror = (e) => {
    console.warn("[audio] 朗读出错:", (e as any)?.error || e);
    finish();
  };

  // 安全网：15秒超时
  const safety = setTimeout(() => {
    console.warn("[audio] 朗读超时(15s)");
    synth.cancel();
    finish();
  }, 15000);

  synth.speak(utterance);
  console.log("[audio] speak() 已调用");
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
        // 安全网：10秒超时（服务器音频应快速加载）
        const safety = setTimeout(() => { audio.pause(); resolve(); }, 10000);
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
