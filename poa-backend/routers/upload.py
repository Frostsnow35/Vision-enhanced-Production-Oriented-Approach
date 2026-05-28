"""
上传路由 —— 处理图片和音频文件上传。
所有上传文件保存在 uploads/ 目录下，按类型分子目录。
"""
import logging
import os
import uuid
import shutil

from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(prefix="/api/upload", tags=["upload"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upload")

# 上传文件保存的根目录（使用绝对路径，基于当前文件所在目录）
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_ROOT = os.path.join(BACKEND_ROOT, "uploads")


# === POST /api/upload/image ===
@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    """
    接收图片上传，保存到 uploads/images/，返回访问路径。
    支持格式：jpg / jpeg / png / webp
    """
    try:
        # 1. 校验文件类型
        allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
        ext = os.path.splitext(file.filename or ".jpg")[-1].lower()
        if ext not in allowed_exts:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的图片格式 '{ext}'，允许: {allowed_exts}",
            )

        # 2. 确保保存目录存在
        save_dir = os.path.join(UPLOAD_ROOT, "images")
        os.makedirs(save_dir, exist_ok=True)
        logger.info(f"[upload_image] 保存目录: {save_dir}")

        # 3. 生成唯一文件名并保存
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(save_dir, filename)

        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 4. 验证文件是否成功写入
        if not os.path.exists(filepath):
            raise HTTPException(
                status_code=500,
                detail="文件保存失败，请检查目录权限",
            )

        # 5. 返回相对于 /uploads 挂载点的路径
        image_url = f"uploads/images/{filename}"
        logger.info(f"[upload_image] 成功: {image_url}")
        return {"image_url": image_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[upload_image] 异常: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"上传失败: {str(e)}",
        )


# === POST /api/upload/audio ===
@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    """
    接收音频上传，保存到 uploads/audio/，返回访问路径。
    支持格式：webm / mp3 / wav / ogg
    """
    try:
        # 1. 校验文件类型
        allowed_exts = {".webm", ".mp3", ".wav", ".ogg", ".m4a"}
        ext = os.path.splitext(file.filename or ".webm")[-1].lower()
        if ext not in allowed_exts:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的音频格式 '{ext}'，允许: {allowed_exts}",
            )

        # 2. 确保保存目录存在
        save_dir = os.path.join(UPLOAD_ROOT, "audio")
        os.makedirs(save_dir, exist_ok=True)

        # 3. 生成唯一文件名并保存
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(save_dir, filename)

        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 4. 验证文件是否成功写入
        if not os.path.exists(filepath):
            raise HTTPException(
                status_code=500,
                detail="文件保存失败，请检查目录权限",
            )

        # 5. 返回访问 URL
        audio_url = f"uploads/audio/{filename}"
        logger.info(f"[upload_audio] 成功: {audio_url}")
        return {"audio_url": audio_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[upload_audio] 异常: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"上传失败: {str(e)}",
        )
