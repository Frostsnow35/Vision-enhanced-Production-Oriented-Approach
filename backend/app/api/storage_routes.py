import uuid
from fastapi import APIRouter, HTTPException
from app.schemas import schemas
from config.settings import settings

router = APIRouter(prefix="/storage", tags=["Storage"])

@router.post("/presigned-url", response_model=schemas.PresignedUrlResponse)
async def get_presigned_url(file_name: str):
    try:
        file_extension = file_name.split(".")[-1].lower()
        if file_extension not in ["jpg", "jpeg", "png", "gif"]:
            return schemas.PresignedUrlResponse(
                success=False,
                error="Unsupported file type"
            )
        
        if settings.S3_ACCESS_KEY_ID and settings.S3_SECRET_ACCESS_KEY and settings.S3_BUCKET_NAME:
            import boto3
            from botocore.config import Config
            
            session = boto3.session.Session(
                aws_access_key_id=settings.S3_ACCESS_KEY_ID,
                aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY
            )
            
            s3 = session.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT_URL,
                config=Config(signature_version="s3v4")
            )
            
            object_key = f"photos/{uuid.uuid4()}.{file_extension}"
            
            presigned_url = s3.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": settings.S3_BUCKET_NAME,
                    "Key": object_key,
                    "ContentType": f"image/{file_extension}"
                },
                ExpiresIn=3600
            )
            
            photo_url = f"{settings.S3_ENDPOINT_URL}/{settings.S3_BUCKET_NAME}/{object_key}"
            
            return schemas.PresignedUrlResponse(
                success=True,
                upload_url=presigned_url,
                photo_url=photo_url
            )
        else:
            mock_url = f"https://example.com/photos/{uuid.uuid4()}.{file_extension}"
            return schemas.PresignedUrlResponse(
                success=True,
                upload_url="mock-upload-url",
                photo_url=mock_url
            )
    except Exception as e:
        return schemas.PresignedUrlResponse(
            success=False,
            error=str(e)
        )