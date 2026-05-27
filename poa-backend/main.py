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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ensure upload directories exist
    os.makedirs("uploads/images", exist_ok=True)
    os.makedirs("uploads/audio", exist_ok=True)
    os.makedirs("uploads/tts", exist_ok=True)

    # auto-create tables
    Base.metadata.create_all(bind=engine)

    # migrate: add image_hash column for older databases (SQLite 3.35+)
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE scenarios ADD COLUMN image_hash VARCHAR(32)"
            ))
            conn.commit()
    except Exception:
        pass  # column already exists, ignore

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

# mount sample_images as static files
os.makedirs("sample_images", exist_ok=True)
app.mount("/samples", StaticFiles(directory="sample_images"), name="samples")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/")
def root():
    return {"message": "POA English Learning Backend — visit /docs for API docs"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
