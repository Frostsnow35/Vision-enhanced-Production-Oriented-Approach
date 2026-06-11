"""
FastAPI 主入口 — POA English Learning Backend。
启动时自动建表、创建目录；中间件：CORS + 请求日志 + 速率限制。
"""
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import engine, UPLOAD_DIR, ASR_ENABLED, DOUBAO_API_KEY
from models import Base

from routers.upload import router as upload_router
from routers.scenario import router as scenario_router
from routers.attempt import router as attempt_router
from routers.evaluate import router as evaluate_router
from routers.facilitate import router as facilitate_router
from routers.exercise import router as exercise_router
from routers.chat import router as chat_router
from routers.report import router as report_router
from routers.translate import router as translate_router

# ---- 日志 ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("main")

# ---- 简易速率限制器 ----
_RATE_WINDOW = 60       # 窗口 60 秒
_RATE_LIMIT = 30        # 每窗口最多 30 次
_rate_store: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))


def _check_rate(client_ip: str) -> bool:
    """检查 IP 是否超出速率限制。返回 True 表示允许。"""
    count, window_start = _rate_store[client_ip]
    now = time.time()
    if now - window_start > _RATE_WINDOW:
        _rate_store[client_ip] = (1, now)
        return True
    if count >= _RATE_LIMIT:
        return False
    _rate_store[client_ip] = (count + 1, window_start)
    return True


# ---- 生命周期 ----
@asynccontextmanager

async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(UPLOAD_DIR, "images"), exist_ok=True)
    os.makedirs(os.path.join(UPLOAD_DIR, "audio"), exist_ok=True)
    os.makedirs(os.path.join(UPLOAD_DIR, "tts"), exist_ok=True)

    Base.metadata.create_all(bind=engine)

    # 兼容旧表迁移
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE scenarios ADD COLUMN image_hash VARCHAR(32)"))
            conn.commit()
    except Exception:
        pass

    yield


app = FastAPI(
    title="POA English Learning Backend",
    description="POA scenario analysis -> attempt diagnosis -> facilitate -> evaluate",
    version="0.1.0",
    lifespan=lifespan,
)

# ---- CORS ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- 请求日志 + 速率限制中间件 ----
@app.middleware("http")

async def log_and_throttle(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    t0 = time.time()

    # 速率检查（跳过 /docs /openapi /health 等）
    path = request.url.path
    if not path.startswith(("/docs", "/redoc", "/openapi.json", "/favicon.ico", "/health")):
        if not _check_rate(client_ip):
            logger.warning(f"[RATE-LIMIT] {client_ip} — {request.method} {path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Too Many Requests — 每分钟最多 30 次请求"},
            )

    response = await call_next(request)
    elapsed = (time.time() - t0) * 1000

    logger.info(
        f"[REQ] {client_ip} — {request.method} {path} → {response.status_code} ({elapsed:.0f}ms)"
    )

    return response


# ---- 注册路由 ----
app.include_router(upload_router)
app.include_router(scenario_router)
app.include_router(attempt_router)
app.include_router(evaluate_router)
app.include_router(facilitate_router)
app.include_router(exercise_router)
app.include_router(chat_router)
app.include_router(report_router)
app.include_router(translate_router)

# ---- 静态文件 ----
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
# 样例图片目录
import os
SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "sample_images")
app.mount("/samples", StaticFiles(directory=SAMPLE_DIR), name="samples")


@app.get("/")

def root():
    return {"message": "POA English Learning Backend — visit /docs for API docs"}


@app.get("/health")

def health_check():
    return {
        "status": "ok",
        "asr_enabled": ASR_ENABLED,
        "api_key_configured": bool(DOUBAO_API_KEY),
        "upload_dir": UPLOAD_DIR,
    }
