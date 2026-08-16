/**
 * 音频播放工具
 * 仅播放服务器 TTS 音频，不降级浏览器 SpeechSynthesis（避免不自然的机器语音）。
 */

let _currentAudio: HTMLAudioElement | null = null;
let _finishCurrent: (() => void) | null = null;

/**
 * 停止当前正在播放的 AI 音频（用户点击说话时打断播放）。
 * 会触发对应的播放状态回调（onStateChange(false)），使 UI 退出“说话中”状态。
 */
export function stopAiAudio(): void {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  if (_finishCurrent) {
    _finishCurrent();
    _finishCurrent = null;
  }
}

/**
 * 播放服务端 TTS 音频。新播放会自动停止上一个未结束的音频。
 * @param audioUrl 服务端返回的音频 URL（可为空，已含 BASE_URL）
 * @param onStateChange 播放状态回调
 */
export async function playAiAudio(
  audioUrl: string | undefined | null,
  onStateChange?: (isPlaying: boolean) => void
): Promise<void> {
  // 停止上一个正在播放的音频（不触发其状态回调，避免与新播放状态互相覆盖）
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  _finishCurrent = null;

  if (!audioUrl) {
    onStateChange?.(false);
    return;
  }

  onStateChange?.(true);

  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(audioUrl);
      _currentAudio = audio;

      let safety: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(safety);
        if (_currentAudio === audio) _currentAudio = null;
        if (_finishCurrent === finish) _finishCurrent = null;
        resolve();
      };
      _finishCurrent = finish;

      // 30 秒安全超时（正常 TTS 一句话不会超过 30 秒，超时即视为异常）
      safety = setTimeout(() => {
        if (_currentAudio === audio) _currentAudio = null;
        if (_finishCurrent === finish) _finishCurrent = null;
        resolve();
      }, 30_000);

      audio.onended = finish;
      audio.onerror = () => {
        clearTimeout(safety);
        if (_currentAudio === audio) _currentAudio = null;
        if (_finishCurrent === finish) _finishCurrent = null;
        reject(new Error("Audio load error"));
      };
      audio.play().catch((e: Error) => {
        clearTimeout(safety);
        if (_currentAudio === audio) _currentAudio = null;
        if (_finishCurrent === finish) _finishCurrent = null;
        reject(e);
      });
    });
  } catch {
    // 静默失败，不降级
  } finally {
    onStateChange?.(false);
  }
}
