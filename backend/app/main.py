from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.poa_routes import router as poa_router
from app.api.storage_routes import router as storage_router
from app.models import Base, engine
from config.settings import settings

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="POA English Learning API",
    description="API for POA (Production-Oriented Approach) English learning platform",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(poa_router, prefix=settings.API_PREFIX)
app.include_router(storage_router, prefix=settings.API_PREFIX)

@app.get("/")
async def root():
    return {"message": "POA English Learning API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}