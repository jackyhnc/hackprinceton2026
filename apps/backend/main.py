import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routes import preset, sessions, swarm, twins, webhooks

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)

app = FastAPI(title="TwinStore Backend", version="0.0.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(webhooks.router)
app.include_router(twins.router)
app.include_router(swarm.router)
app.include_router(preset.router)


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "knot_env": settings.knot_environment,
        "has_supabase": bool(settings.supabase_url and settings.supabase_secret_key),
        "has_k2": bool(settings.k2_api_key),
        "has_knot": bool(settings.knot_client_id and settings.knot_secret),
    }
