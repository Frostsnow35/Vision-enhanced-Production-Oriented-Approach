"""
FastAPI main entry — POA English Learning Backend.
On startup: creates upload dirs, DB tables, and migrates legacy schema.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import engine
from models import Base

from routers.upload import router as upload_router
from routers.scenario import router as scenario_router
from routers.attempt import router as attempt_router
from routers.evaluate import router as evaluate_router
from routers.facilitate import router as facilitate_router
from routers.exercise import router as exercise_router
from routers.chat import router as chat_router

# 使用绝对路径，避免 cwd 问题
BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BACKEND_ROOT, "uploads")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(UPLOAD_DIR, "images"), exist_ok=True)
    os.makedirs(os.path.join(UPLOAD_DIR, "audio"), exist_ok=True)
    os.makedirs(os.path.join(UPLOAD_DIR, "tts"), exist_ok=True)

    Base.metadata.create_all(bind=engine)

    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE scenarios ADD COLUMN image_hash VARCHAR(32)"
            ))
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router)
app.include_router(scenario_router)
app.include_router(attempt_router)
app.include_router(evaluate_router)
app.include_router(facilitate_router)
app.include_router(exercise_router)
app.include_router(chat_router)

os.makedirs(os.path.join(UPLOAD_DIR, "images"), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "audio"), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "tts"), exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
def root():
    return {"message": "POA English Learning Backend — visit /docs for API docs"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
