"""
上传路由 —— 处理图片和音频文件上传。
所有上传文件保存在 uploads/ 目录下，按类型分子目录。
"""
import os
import uuid
import shutil

from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(prefix="/api/upload", tags=["upload"])

# 上传文件保存的根目录（相对于项目根目录）
UPLOAD_ROOT = "uploads"


# === POST /api/upload/image ===
@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    """
    接收图片上传，保存到 uploads/images/，返回访问路径。
    支持格式：jpg / jpeg / png / webp
    """
    # 1. 校验文件类型
    allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
    ext = os.path.splitext(file.filename or ".jpg")[-1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式 '{ext}'，允许: {allowed_exts}",
        )

    # 2. 生成唯一文件名并保存
    save_dir = os.path.join(UPLOAD_ROOT, "images")
    os.makedirs(save_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(save_dir, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 3. 返回访问 URL（绝对路径，前端拼接 base URL 即可访问）
    image_url = f"/{save_dir}/{filename}".replace("\\", "/")
    return {"image_url": image_url}


# === POST /api/upload/audio ===
@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    """
    接收音频上传，保存到 uploads/audio/，返回访问路径。
    支持格式：webm / mp3 / wav / ogg
    """
    # 1. 校验文件类型
    allowed_exts = {".webm", ".mp3", ".wav", ".ogg", ".m4a"}
    ext = os.path.splitext(file.filename or ".webm")[-1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的音频格式 '{ext}'，允许: {allowed_exts}",
        )

    # 2. 生成唯一文件名并保存
    save_dir = os.path.join(UPLOAD_ROOT, "audio")
    os.makedirs(save_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(save_dir, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 3. 返回访问 URL（绝对路径）
    audio_url = f"/{save_dir}/{filename}".replace("\\", "/")
    return {"audio_url": audio_url}
