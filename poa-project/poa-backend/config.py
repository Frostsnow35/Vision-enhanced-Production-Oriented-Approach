import os
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# 数据库：优先使用环境变量 DATABASE_URL，否则使用 Railway 持久卷 /data/ 下的 SQLite
# 本地开发时回退到项目根目录下的 poa.db
_DEFAULT_DB = "sqlite:////data/poa.db" if os.path.isdir("/data") else "sqlite:///./poa.db"
DATABASE_URL = os.getenv("DATABASE_URL", _DEFAULT_DB)

_connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args["check_same_thread"] = False
elif DATABASE_URL.startswith("postgresql"):
    # Railway/Postgres 需要 SSL
    _connect_args["sslmode"] = os.getenv("DB_SSLMODE", "require")

engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# 豆包 API 配置 — 从环境变量读取
DOUBAO_API_KEY = os.getenv("DOUBAO_API_KEY", "")
DOUBAO_MODEL_ID = os.getenv("DOUBAO_MODEL_ID", "doubao-seed-2-0-mini-260428")
DOUBAO_BASE_URL = os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

# Ark SDK 配置
ARK_API_KEY = os.getenv("ARK_API_KEY", DOUBAO_API_KEY)
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "doubao-1.5-vision-pro-32k")

# 服务端口
PORT = int(os.getenv("PORT", "8000"))

# 上传文件存储目录：Railway 持久卷 /data/ 或本地项目目录下的 uploads/
_backend_dir = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads" if os.path.isdir("/data") else os.path.join(_backend_dir, "uploads"))

# ASR: 是否启用本地 Whisper（Railway 环境默认禁用，因为 torch 太大）
ASR_ENABLED = os.getenv("ASR_ENABLED", "0" if os.path.isdir("/data") else "1") == "1"

# 音频分析：是否启用 Whisper 词级分析（发音+流利度评分）
ENABLE_AUDIO_ANALYSIS = os.getenv("ENABLE_AUDIO_ANALYSIS", "1" if ASR_ENABLED else "0") == "1"
