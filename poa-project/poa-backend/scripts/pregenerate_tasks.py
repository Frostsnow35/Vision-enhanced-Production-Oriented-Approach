"""
预生成任务脚本 —— 遍历 sample_images/ 目录，对每张照片调用场景分析，
将结果存入数据库。后续 /api/scenario/analyze 请求这些图片时会命中缓存。

用法:
    cd poa-backend
    venv/Scripts/python.exe scripts/pregenerate_tasks.py

可选参数:
    --force   强制重新生成（清除已有缓存后重新分析所有图片）
"""
import argparse
import logging
import os
import sys
import time

# 确保项目根目录在 sys.path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import SessionLocal
from services.ai_service import get_or_analyze_scenario
from services.report_service import invalidate_cache as invalidate_report_cache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pregenerate")

SAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_images")
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main():
    parser = argparse.ArgumentParser(description="预生成 sample_images 的场景分析结果")
    parser.add_argument("--force", action="store_true", help="强制重新生成所有图片")
    args = parser.parse_args()

    # 扫描图片
    image_files: list[str] = []
    for fname in sorted(os.listdir(SAMPLE_DIR)):
        ext = os.path.splitext(fname)[1].lower()
        if ext in SUPPORTED_EXTS:
            image_files.append(fname)

    if not image_files:
        logger.warning(f"未找到图片文件 ({SUPPORTED_EXTS})，目录: {SAMPLE_DIR}")
        return

    logger.info(f"找到 {len(image_files)} 张图片: {', '.join(image_files)}")
    if args.force:
        logger.info("--force: 将强制重新分析所有图片")

    # 逐张处理
    db = SessionLocal()
    total = len(image_files)
    success = 0
    cached = 0
    failed = 0
    t_start = time.time()

    for i, fname in enumerate(image_files, 1):
        image_path = os.path.join(SAMPLE_DIR, fname)
        logger.info(f"\n{'='*50}")
        logger.info(f"[{i}/{total}] 处理: {fname}")

        if args.force:
            # 删除已有记录（按路径查找）
            from models import Scenario
            existing = db.query(Scenario).filter(Scenario.image_path == image_path).all()
            for s in existing:
                db.delete(s)
            db.commit()
            invalidate_report_cache()

        try:
            t0 = time.time()
            result = get_or_analyze_scenario(image_path=image_path, db=db)

            # 判断是缓存命中还是新生成
            # get_or_analyze_scenario 内部打印了"缓存命中"或"调用 VLM"
            dt = time.time() - t0
            if dt < 0.5:
                # 快速返回大概率是缓存
                cached += 1
            else:
                success += 1

            logger.info(
                f"[{i}/{total}] ✓ {fname}"
                f" — scene_label={result.get('scene_label', '?')[:40]}"
                f" — {dt:.1f}s"
            )
        except Exception as e:
            failed += 1
            logger.error(f"[{i}/{total}] ✗ {fname} — {e}")

    db.close()

    # 汇总
    total_time = time.time() - t_start
    logger.info(f"\n{'='*50}")
    logger.info(f"预生成完成 — 总计 {total} 张, "
                f"新生成 {success}, 缓存命中 {cached}, 失败 {failed}")
    logger.info(f"总耗时: {total_time:.1f}s")

    # 提示
    logger.info("\n现在启动服务后，前端请求 /api/scenario/analyze 将即时返回缓存结果。")


if __name__ == "__main__":
    main()
