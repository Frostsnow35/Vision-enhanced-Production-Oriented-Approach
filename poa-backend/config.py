import os
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

DATABASE_URL = "sqlite:///./poa.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

DOUBAO_API_KEY = os.getenv("DOUBAO_API_KEY", "")
DOUBAO_MODEL_ID = "doubao-seed-2.0-mini-260428"
DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

# Ark SDK 配置
ARK_API_KEY = DOUBAO_API_KEY
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "doubao-seed-2-0-mini-260428")