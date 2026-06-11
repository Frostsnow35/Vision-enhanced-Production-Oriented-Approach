"""
音频分析服务 —— 基于 Whisper 词级时间戳提取发音置信度和流利度指标。

评分体系：
- 发音标准度：词级置信度均值 + 低置信词占比
- 流利度：语速(WPM) + 停顿频率 + 平均停顿时长

架构预留：
- raw_metrics 存储原始声学指标，供后续韵律分析扩展
- analyze_prosody() 空函数，后续接入 librosa/praat
"""
import logging
import os
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from config import UPLOAD_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("audio_analysis")

# 复用 asr_service 的全局模型，避免重复加载
from services.asr_service import _check_whisper, _load_model


# ============================================================
# 评分映射函数
# ============================================================

def _resolve_path(path_or_url: str) -> str:
    """将 URL 路径（如 /uploads/audio/xxx.webm）解析为本地绝对路径"""
    # 已经是绝对路径且存在
    if os.path.isabs(path_or_url) and os.path.isfile(path_or_url):
        return path_or_url
    # URL 路径：/uploads/audio/xxx.webm -> UPLOAD_DIR/audio/xxx.webm
    if path_or_url.startswith("/uploads/"):
        rel = path_or_url[len("/uploads/"):]
        return os.path.join(UPLOAD_DIR, rel)
    # 相对于 UPLOAD_DIR
    candidate = os.path.join(UPLOAD_DIR, path_or_url.lstrip("/"))
    if os.path.isfile(candidate):
        return candidate
    # 直接使用原路径
    return path_or_url


def _confidence_to_score(mean_conf: float, low_conf_ratio: float) -> float:
    """将词级置信度映射到 1.0~5.0 发音标准度分数"""
    raw = mean_conf * 5.0 * (1.0 - low_conf_ratio * 0.5)
    return round(max(1.0, min(5.0, raw)), 1)


def _wpm_to_score(wpm: float) -> float:
    """将语速(WPM)映射到 1.0~5.0"""
    if wpm >= 120:
        return 5.0
    if wpm >= 100:
        return 4.0 + (wpm - 100) / 20
    if wpm >= 80:
        return 3.0 + (wpm - 80) / 20
    if wpm >= 60:
        return 2.0 + (wpm - 60) / 20
    if wpm >= 40:
        return 1.0 + (wpm - 40) / 20
    return 1.0


def _pauses_to_score(pause_count: float, avg_pause_dur: float) -> float:
    """将停顿指标映射到 1.0~5.0 流利度子分"""
    # 停顿频率惩罚（每分钟停顿数，越少越好）
    pause_freq_score = max(1.0, 5.0 - pause_count * 0.8)
    # 平均停顿时长惩罚（秒，越短越好）
    pause_dur_score = 1.0 if avg_pause_dur >= 3.0 else (
        2.0 if avg_pause_dur >= 2.0 else (
        3.0 if avg_pause_dur >= 1.5 else (
        4.0 if avg_pause_dur >= 1.0 else 5.0
    )))
    return round(pause_freq_score * 0.5 + pause_dur_score * 0.5, 1)


# ============================================================
# 核心分析函数
# ============================================================

def analyze_audio(audio_paths: List[str]) -> Optional[Dict[str, Any]]:
    """
    分析一个或多个音频文件，提取发音和流利度指标。
    
    @param audio_paths 音频文件路径或URL列表（一个 attempt 中所有录音）
    @return 包含 pronunciation_score, fluency_score, raw_metrics 的字典
            若 Whisper 不可用或所有文件无效则返回 None
    """
    if not audio_paths:
        logger.warning("[audio_analysis] audio_paths 为空")
        return None
    if not _check_whisper():
        logger.warning("[audio_analysis] Whisper 不可用")
        return None

    model = _load_model()
    if model is None:
        return None

    # 聚合所有有效 segments
    all_segments: List[Dict[str, Any]] = []
    valid_count = 0

    for path in audio_paths:
        if not path:
            continue
        # 将 URL 路径（如 /uploads/audio/xxx.webm）解析为本地文件路径
        resolved = _resolve_path(path)
        if not os.path.isfile(resolved):
            logger.warning(f"[audio_analysis] 跳过无效文件: {resolved}")
            continue

        try:
            result = model.transcribe(resolved, word_timestamps=True)
            segments = result.get("segments", [])
            all_segments.extend(segments)
            valid_count += 1
            logger.info(f"[audio_analysis] {resolved}: {len(segments)} segments")
        except Exception as e:
            logger.error(f"[audio_analysis] 转写失败 {path}: {e}")
            continue

    if not all_segments:
        logger.warning("[audio_analysis] 无有效 segments")
        return None

    # 提取词级数据
    words = []
    for seg in all_segments:
        for w in seg.get("words", []):
            words.append({
                "text": w.get("word", "").strip(),
                "start": w.get("start", 0),
                "end": w.get("end", 0),
                "confidence": w.get("probability", 0),
            })

    if not words:
        logger.warning("[audio_analysis] 无词级数据")
        return None

    # --- 发音标准度 ---
    confidences = [w["confidence"] for w in words if w["confidence"] > 0]
    if not confidences:
        logger.warning("[audio_analysis] 无有效置信度")
        return None

    mean_conf = float(np.mean(confidences))
    low_conf_count = sum(1 for c in confidences if c < 0.6)
    low_conf_ratio = low_conf_count / len(confidences)
    pronunciation_score = _confidence_to_score(mean_conf, low_conf_ratio)

    # --- 流利度 ---
    total_duration = words[-1]["end"] - words[0]["start"]
    total_duration_minutes = total_duration / 60.0 if total_duration > 0 else 0.001

    wpm = len(words) / total_duration_minutes
    wpm_score = _wpm_to_score(wpm)

    # 停顿分析（词间间隔 > 0.5s 视为停顿）
    gaps = []
    for i in range(1, len(words)):
        gap = words[i]["start"] - words[i - 1]["end"]
        if gap > 0.5:
            gaps.append(gap)

    pause_count_per_min = len(gaps) / total_duration_minutes if total_duration_minutes > 0 else 0
    avg_pause_dur = float(np.mean(gaps)) if gaps else 0
    pause_score = _pauses_to_score(pause_count_per_min, avg_pause_dur)

    # 流利度综合分 = WPM(40%) + 停顿(30%) + 停顿时长(30%)
    fluency_score = round(wpm_score * 0.4 + pause_score * 0.3 + pause_score * 0.3, 1)

    # --- raw_metrics（扩展预留）---
    raw_metrics = {
        "total_words": len(words),
        "total_duration_seconds": round(total_duration, 2),
        "wpm": round(wpm, 1),
        "mean_confidence": round(mean_conf, 4),
        "low_conf_ratio": round(low_conf_ratio, 3),
        "pause_count": len(gaps),
        "pause_count_per_minute": round(pause_count_per_min, 1),
        "average_pause_duration_seconds": round(avg_pause_dur, 2),
        "gaps": [round(g, 2) for g in gaps],
        "confidences": [round(c, 4) for c in confidences],
        "valid_audio_files": valid_count,
        "total_audio_files": len(audio_paths),
    }

    logger.info(
        f"[audio_analysis] pron={pronunciation_score} flu={fluency_score} "
        f"wpm={wpm:.1f} conf={mean_conf:.3f} lowConf={low_conf_ratio:.1%} "
        f"pauses/min={pause_count_per_min:.1f} avgGap={avg_pause_dur:.2f}s"
    )

    return {
        "pronunciation_score": pronunciation_score,
        "fluency_score": fluency_score,
        "raw_metrics": raw_metrics,
    }


def analyze_prosody(audio_path: str) -> Optional[Dict[str, Any]]:
    """
    韵律分析（预留接口，后续接入 librosa）
    
    计划指标：
    - pitch_mean, pitch_range, pitch_contour (F0 基频分析)
    - stress_pattern (幅度/时长比)
    - speech_rate_variance (语速变化)
    """
    # TODO: 接入 librosa 实现
    return None
