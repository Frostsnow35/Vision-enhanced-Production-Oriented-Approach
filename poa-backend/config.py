import os
import re
import logging
from urllib.parse import quote_plus, urlparse, urlunparse
from dotenv import load_dotenv

load_dotenv()

# 确保模块级日志有输出（main.py 导入本模块时 basicConfig 尚未执行）
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

logger = logging.getLogger("poa.config")


def _sanitize_database_url(raw_url: str) -> str:
    """
    清洗 DATABASE_URL，解决 Railway 上常见的解析问题：
    1. 去除首尾空白、换行、引号
    2. postgres:// → postgresql://（SQLAlchemy 2.0 已移除 postgres:// 别名）
    3. 对密码中的特殊字符做 URL 编码
    """
    url = raw_url.strip().strip("`'\"")

    if not url:
        return url

    # SQLAlchemy 2.0 不再接受 postgres:// 前缀
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    elif url.startswith("postgresql://"):
        pass  # already correct
    elif url.startswith("sqlite"):
        return url  # SQLite 无需进一步处理
    else:
        # 非数据库 URL，原样返回（让 SQLAlchemy 自行报错）
        return url

    # 解析 URL 并对密码做 URL 编码，防止特殊字符导致解析失败
    try:
        parsed = urlparse(url)
        if parsed.password:
            encoded_password = quote_plus(parsed.password)
            # 仅在密码确实需要编码时才重建 URL
            if encoded_password != parsed.password:
                netloc = f"{parsed.username}:{encoded_password}@{parsed.hostname}"
                if parsed.port:
                    netloc += f":{parsed.port}"
                parsed = parsed._replace(netloc=netloc)
                url = urlunparse(parsed)
    except Exception:
        pass  # 解析失败时保留原 URL，让 SQLAlchemy 报出更具体的错误

    # 打印清洗后的 URL（密码脱敏）
    masked = re.sub(r":([^@]+)@", ":****@", url)
    logger.info("Sanitized DATABASE_URL: %s", masked)

    return url


# 数据库：优先使用环境变量 DATABASE_URL，否则使用 Railway 持久卷 /data/ 下的 SQLite
# 本地开发时回退到项目根目录下的 poa.db
_DEFAULT_DB = "sqlite:////data/poa.db" if os.path.isdir("/data") else "sqlite:///./poa.db"
_RAW_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DATABASE_URL = _sanitize_database_url(_RAW_DATABASE_URL) if _RAW_DATABASE_URL else _DEFAULT_DB

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


def _normalize_ark_model_id(model_id: str) -> str:
    """
    兼容历史误配的模型 ID 写法。
    例如：doubao-seed-2.0-mini-260428 -> doubao-seed-2-0-mini-260428
    Ark chat/completions 端点使用的是连字符版本。
    """
    value = (model_id or "").strip()
    if not value:
        return "doubao-seed-2-0-mini-260428"
    # 将数字.数字规范化为数字-数字，避免 404 InvalidEndpointOrModel.NotFound
    return re.sub(r"(?<=\d)\.(?=\d)", "-", value)


DOUBAO_MODEL_ID = _normalize_ark_model_id(os.getenv("DOUBAO_MODEL_ID", "doubao-seed-2-0-mini-260428"))
DOUBAO_BASE_URL = os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

# Ark SDK 配置
ARK_API_KEY = os.getenv("ARK_API_KEY", DOUBAO_API_KEY)
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "doubao-1.5-vision-pro-32k")

# 服务端口
PORT = int(os.getenv("PORT", "8000"))

# 上传文件存储目录：Railway 持久卷 /data/ 或本地项目目录下的 uploads/
_backend_dir = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads" if os.path.isdir("/data") else os.path.join(_backend_dir, "uploads"))

# 豆包 TTS 配置（火山引擎语音合成 V3）
DOUBAO_TTS_APP_ID = os.getenv("DOUBAO_TTS_APP_ID", "")
DOUBAO_TTS_TOKEN = os.getenv("DOUBAO_TTS_TOKEN", "")
# TTS voice type: 英语美式发音（seed-tts-2.0 英文音色）
DOUBAO_TTS_VOICE = os.getenv("DOUBAO_TTS_VOICE", "en_female_dacey_uranus_bigtts")
# TTS resource ID（对应豆包语音合成模型 2.0）
DOUBAO_TTS_RESOURCE_ID = os.getenv("DOUBAO_TTS_RESOURCE_ID", "seed-tts-2.0")
# TTS API endpoint (V3)
DOUBAO_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

# ─── 豆包 ASR 配置（火山引擎流式语音识别 —— WebSocket 实时转写）───
# 鉴权：优先新版 X-Api-Key，回退旧版 App-Key + Access-Key
DOUBAO_ASR_APP_ID = os.getenv("DOUBAO_ASR_APP_ID", "")
DOUBAO_ASR_TOKEN = os.getenv("DOUBAO_ASR_TOKEN", "")
DOUBAO_ASR_API_KEY = os.getenv("DOUBAO_ASR_API_KEY", "")
# 流式模型 resource_id（需带计费后缀）: volc.bigasr.sauc.duration(1.0小时版) / volc.bigasr.sauc.concurrent(1.0并发版)
# 2.0 版为 volc.seedasr.sauc.duration，需先在火山控制台开通对应资源（实测当前账号未开通，会返回 400）
DOUBAO_ASR_STREAM_RESOURCE_ID = os.getenv("DOUBAO_ASR_STREAM_RESOURCE_ID", "volc.bigasr.sauc.duration")
# 火山流式 ASR WebSocket 地址
DOUBAO_ASR_STREAM_URL = os.getenv("DOUBAO_ASR_STREAM_URL", "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel")
# 流式 ASR 超时秒数
DOUBAO_ASR_STREAM_TIMEOUT = int(os.getenv("DOUBAO_ASR_STREAM_TIMEOUT", "60"))

# ─── 旧版 ASR 配置（录音文件识别标准版，保留兼容但不作为主通道）───
DOUBAO_ASR_RESOURCE_ID = os.getenv("DOUBAO_ASR_RESOURCE_ID", "volc.seedasr.auc")
DOUBAO_ASR_SUBMIT_URL = os.getenv("DOUBAO_ASR_SUBMIT_URL", "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit")
DOUBAO_ASR_QUERY_URL = os.getenv("DOUBAO_ASR_QUERY_URL", "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query")

# 后端公网访问地址，用于构造 ASR/TTS 等外部服务可下载的音频 URL
# Railway 容器内 request.base_url 可能拿到内网地址（0.0.0.0:8000），导致火山引擎无法下载
# 示例: https://poa-backend-production-c371.up.railway.app
# 注意: 粘贴环境变量时可能误带反引号/引号/空格，这里做防御性清洗
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "").strip().strip("`'\"").rstrip("/")
