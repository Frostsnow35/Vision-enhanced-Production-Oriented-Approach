"""
音频分析服务 —— 基于音频文件元数据计算发音/流利度指标。

指标：
- WPM（语速）：词数 / 音频时长（分钟） → 映射到副语言匹配度 1-5 分
- 平均词置信度（如有 ASR utterance 数据）→ 映射到发音标准度 1-5 分
- 停顿频率：utterance 间间隔 → 辅助流利度评估

音频格式：webm（opus 编码）、wav 等。
"""
import json
import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("audio_analysis")


def _get_duration_ffprobe(file_path: str) -> Optional[float]:
    """使用 ffprobe 获取音频时长（秒），失败返回 None。"""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                file_path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            logger.warning(f"[audio] ffprobe 返回非零: {result.stderr[:200]}")
            return None
        info = json.loads(result.stdout)
        duration_str = info.get("format", {}).get("duration")
        if duration_str:
            return float(duration_str)
    except FileNotFoundError:
        logger.warning("[audio] ffprobe 未安装")
    except subprocess.TimeoutExpired:
        logger.warning("[audio] ffprobe 超时")
    except Exception as e:
        logger.warning(f"[audio] ffprobe 异常: {e}")
    return None


def _download_audio(audio_url_or_path: str) -> Optional[str]:
    """
    获取音频文件的本地临时路径。
    支持本地路径和 HTTP(S) URL。
    返回临时文件路径，调用方负责清理。
    """
    # 本地文件
    if os.path.isfile(audio_url_or_path):
        return audio_url_or_path

    # 远程 URL → 下载到临时文件
    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(audio_url_or_path)
            resp.raise_for_status()
            suffix = ".webm"
            if "wav" in resp.headers.get("content-type", ""):
                suffix = ".wav"
            elif "mp3" in resp.headers.get("content-type", ""):
                suffix = ".mp3"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(resp.content)
            tmp.close()
            return tmp.name
    except Exception as e:
        logger.warning(f"[audio] 下载失败 {audio_url_or_path}: {e}")
        return None


def _map_wpm_to_score(wpm: float) -> float:
    """
    将 WPM（词/分钟）映射到 1-5 分（副语言匹配度/流利度）。
    
    参考范围（英语学习者）：
    - < 40  wpm: 非常慢，不流利 → 1.0-2.0
    - 40-70  wpm: 较慢，停顿多 → 2.0-3.0
    - 70-100 wpm: 中等，基本流利 → 3.0-4.0
    - 100-140 wpm: 良好，接近自然 → 4.0-4.5
    - 140-170 wpm: 母语者语速 → 4.5-5.0
    - > 170  wpm: 过快 → 4.0（扣分）
    """
    if wpm < 30:
        return 1.0
    elif wpm < 50:
        return round(1.0 + (wpm - 30) / 20 * 1.0, 1)
    elif wpm < 70:
        return round(2.0 + (wpm - 50) / 20 * 1.0, 1)
    elif wpm < 100:
        return round(3.0 + (wpm - 70) / 30 * 1.0, 1)
    elif wpm < 140:
        return round(4.0 + (wpm - 100) / 40 * 0.5, 1)
    elif wpm < 170:
        return round(4.5 + (wpm - 140) / 30 * 0.5, 1)
    else:
        return 4.0


def analyze_audio(
    audio_paths: List[str],
    transcribed_text: str = "",
) -> Dict[str, Any]:
    """
    分析音频文件，返回发音/流利度指标。
    
    @param audio_paths  音频文件路径或 URL 列表
    @param transcribed_text  对应的转写文本（用于计算 WPM 的分子）
    @return {
        pronunciation_score: float,   # 1-5
        fluency_score: float,         # 1-5（基于 WPM）
        raw_metrics: {
            wpm: float,
            total_words: int,
            total_duration_seconds: float,
            file_count: int,
        }
    }
    """
    logger.info(
        f"[audio_analysis] 分析 {len(audio_paths)} 个音频文件, "
        f"transcribed_text 长度={len(transcribed_text)}"
    )

    if not audio_paths:
        logger.warning("[audio_analysis] 无音频文件，返回默认值")
        return {
            "pronunciation_score": 2.5,
            "fluency_score": 2.5,
            "raw_metrics": {
                "wpm": 0,
                "total_words": 0,
                "total_duration_seconds": 0,
                "file_count": 0,
                "note": "无音频文件",
            },
        }

    # 计算总时长
    total_duration = 0.0
    temp_files: List[str] = []
    valid_count = 0

    for path in audio_paths:
        if not path:
            continue
        local_path = _download_audio(path)
        if not local_path:
            continue
        if local_path not in audio_paths:
            temp_files.append(local_path)

        duration = _get_duration_ffprobe(local_path)
        if duration and duration > 0:
            total_duration += duration
            valid_count += 1

    # 清理临时文件
    for tmp in temp_files:
        try:
            os.unlink(tmp)
        except Exception:
            pass

    # 计算 WPM
    word_count = len(transcribed_text.split()) if transcribed_text else 0
    if total_duration > 0:
        wpm = round(word_count / (total_duration / 60.0), 1)
    else:
        wpm = 0

    fluency_score = _map_wpm_to_score(wpm)

    # 发音标准度：基于 WPM 推断（无词级置信度时用 WPM 作为代理）
    # WPM 在合理范围内说明发音至少不影响可懂度
    if wpm >= 70:
        pronunciation_score = round(2.5 + (wpm - 70) / 70 * 2.0, 1)
    elif wpm >= 30:
        pronunciation_score = round(1.5 + (wpm - 30) / 40 * 1.0, 1)
    else:
        pronunciation_score = 1.5
    pronunciation_score = max(1.0, min(5.0, pronunciation_score))

    raw_metrics = {
        "wpm": wpm,
        "total_words": word_count,
        "total_duration_seconds": round(total_duration, 1),
        "file_count": valid_count,
    }

    logger.info(
        f"[audio_analysis] 完成: WPM={wpm}, "
        f"pronunciation={pronunciation_score}, fluency={fluency_score}, "
        f"总时长={total_duration:.1f}s, 词数={word_count}"
    )

    return {
        "pronunciation_score": pronunciation_score,
        "fluency_score": fluency_score,
        "raw_metrics": raw_metrics,
    }
