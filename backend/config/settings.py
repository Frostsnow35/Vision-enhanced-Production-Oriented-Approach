from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    API_PREFIX: str = "/api"
    PORT: int = 8000
    
    DATABASE_URL: str = "sqlite:///./poa_learning.db"
    
    REDIS_URL: str = "redis://localhost:6379/0"
    
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    
    S3_ENDPOINT_URL: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_BUCKET_NAME: str = ""
    
    MAX_REQUESTS_PER_MINUTE: int = 60
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()