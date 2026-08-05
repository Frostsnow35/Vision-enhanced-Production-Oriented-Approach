/**
 * 音频播放工具
 * 仅播放服务器 TTS 音频，不降级浏览器 SpeechSynthesis（避免不自然的机器语音）。
 */

/**
 * 播放服务端 TTS 音频。
 * @param audioUrl 服务端返回的音频 URL（可为空）
 * @param onStateChange 播放状态回调
 */
export async function playAiAudio(
  audioUrl: string | undefined | null,
  onStateChange?: (isPlaying: boolean) => void
): Promise<void> {
  if (!audioUrl) return;

  const fullUrl = audioUrl.startsWith("http") ? audioUrl : audioUrl;
  onStateChange?.(true);

  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(fullUrl);
      const safety = setTimeout(() => {
        audio.pause();
        resolve();
      }, 15000);
      audio.onended = () => {
        clearTimeout(safety);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(safety);
        reject(new Error("Audio load error"));
      };
      audio.play().catch((e) => {
        clearTimeout(safety);
        reject(e);
      });
    });
  } catch {
    // 静默失败，不降级
  } finally {
    onStateChange?.(false);
  }
}
