"""
上传路由 —— 处理图片和音频文件上传。
所有上传文件保存在 uploads/ 目录下，按类型分子目录。
"""
import logging
import os
import uuid

from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(prefix="/api/upload", tags=["upload"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upload")

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
        logger.info(f"[upload_image] 开始上传文件: {file.filename}")
        
        allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
        ext = os.path.splitext(file.filename or ".jpg")[-1].lower()
        if ext not in allowed_exts:
            logger.error(f"[upload_image] 不支持的格式: {ext}")
            raise HTTPException(
                status_code=400,
                detail=f"不支持的图片格式 '{ext}'，允许: {allowed_exts}",
            )

        save_dir = os.path.join(UPLOAD_ROOT, "images")
        logger.info(f"[upload_image] 保存目录: {save_dir}")
        
        try:
            os.makedirs(save_dir, exist_ok=True)
            logger.info(f"[upload_image] 目录创建成功或已存在")
        except Exception as e:
            logger.error(f"[upload_image] 目录创建失败: {str(e)}")
            save_dir = "/tmp/poa_uploads/images"
            os.makedirs(save_dir, exist_ok=True)
            logger.info(f"[upload_image] 降级到临时目录: {save_dir}")

        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(save_dir, filename)
        logger.info(f"[upload_image] 目标文件: {filepath}")

        try:
            contents = await file.read()
            with open(filepath, "wb") as f:
                f.write(contents)
            logger.info(f"[upload_image] 文件写入成功，大小: {len(contents)} bytes")
        except Exception as e:
            logger.error(f"[upload_image] 文件写入失败: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"文件保存失败: {str(e)}",
            )

        if not os.path.exists(filepath):
            logger.error(f"[upload_image] 文件保存后不存在: {filepath}")
            raise HTTPException(
                status_code=500,
                detail="文件保存失败，请检查目录权限",
            )

        image_url = f"uploads/images/{filename}"
        logger.info(f"[upload_image] 成功: {image_url}")
        return {"image_url": image_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[upload_image] 未处理的异常: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"上传失败: {str(e)}",
        )


# === GET /api/upload/test ===
@router.get("/test")
async def test_upload():
    """测试上传功能是否正常"""
    try:
        test_dir = os.path.join(UPLOAD_ROOT, "images")
        os.makedirs(test_dir, exist_ok=True)
        
        test_file = os.path.join(test_dir, "test.txt")
        with open(test_file, "w") as f:
            f.write("test")
        
        if os.path.exists(test_file):
            os.remove(test_file)
            return {
                "status": "ok",
                "upload_root": UPLOAD_ROOT,
                "test_dir": test_dir,
                "writable": True,
                "message": "上传目录可写"
            }
        else:
            return {"status": "error", "message": "文件写入后不存在"}
    except Exception as e:
        return {
            "status": "error",
            "upload_root": UPLOAD_ROOT,
            "error": str(e),
            "message": "上传目录不可写"
        }


# === POST /api/upload/audio ===
@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    """
    接收音频上传，保存到 uploads/audio/，返回访问路径。
    支持格式：webm / mp3 / wav / ogg
    """
    try:
        logger.info(f"[upload_audio] 开始上传文件: {file.filename}")
        
        allowed_exts = {".webm", ".mp3", ".wav", ".ogg", ".m4a"}
        ext = os.path.splitext(file.filename or ".webm")[-1].lower()
        if ext not in allowed_exts:
            logger.error(f"[upload_audio] 不支持的格式: {ext}")
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "upload_failed",
                    "message": f"不支持的音频格式 '{ext}'，请使用 webm/mp3/wav/ogg 格式",
                },
            )

        save_dir = os.path.join(UPLOAD_ROOT, "audio")
        try:
            os.makedirs(save_dir, exist_ok=True)
        except Exception as e:
            logger.error(f"[upload_audio] 目录创建失败: {str(e)}")
            save_dir = "/tmp/poa_uploads/audio"
            os.makedirs(save_dir, exist_ok=True)
            logger.info(f"[upload_audio] 降级到临时目录: {save_dir}")

        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(save_dir, filename)

        try:
            contents = await file.read()
            with open(filepath, "wb") as f:
                f.write(contents)
            logger.info(f"[upload_audio] 文件写入成功，大小: {len(contents)} bytes")
        except Exception as e:
            logger.error(f"[upload_audio] 文件写入失败: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "upload_failed",
                    "message": "音频文件上传失败，请重试",
                },
            )

        if not os.path.exists(filepath):
            logger.error(f"[upload_audio] 文件保存后不存在: {filepath}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "upload_failed",
                    "message": "音频文件上传失败，请重试",
                },
            )

        audio_url = f"uploads/audio/{filename}"
        logger.info(f"[upload_audio] 成功: {audio_url}")
        return {"audio_url": audio_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[upload_audio] 未处理的异常: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"上传失败: {str(e)}",
        )
