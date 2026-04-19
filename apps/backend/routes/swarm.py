"""Swarm routes — dispatch runs and read results.

Runs fan out (twin, preset) pairs to K2 in the background. Clients poll
GET /swarm/runs/:id for status. Two modes:
- mini: one twin × all presets (auto-triggered after minting)
- full: all twins × all presets (merchant Run button)
"""
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from db import supa
from swarm import run_swarm

logger = logging.getLogger("twinstore.routes.swarm")
router = APIRouter(prefix="/swarm")


class RunRequest(BaseModel):
    kind: str = "full"
    twin_id: str | None = None
    merchant_id: str | None = None


def _resolve_merchant_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    resp = supa().table("merchants").select("id").limit(1).execute()
    if not resp.data:
        raise HTTPException(status_code=400, detail="no merchant configured")
    return resp.data[0]["id"]


@router.post("/run")
async def start_run(req: RunRequest, background: BackgroundTasks) -> dict:
    if req.kind not in ("mini", "full"):
        raise HTTPException(status_code=400, detail="kind must be 'mini' or 'full'")

    db = supa()
    merchant_id = _resolve_merchant_id(req.merchant_id)

    if req.kind == "mini":
        if not req.twin_id:
            raise HTTPException(status_code=400, detail="mini run requires twin_id")
        twin_ids = [req.twin_id]
    else:
        resp = db.table("twins").select("id").execute()
        twin_ids = [r["id"] for r in resp.data or []]
        if not twin_ids:
            raise HTTPException(status_code=400, detail="no twins to score")

    run_id = str(uuid.uuid4())
    db.table("swarm_runs").insert(
        {
            "id": run_id,
            "kind": req.kind,
            "merchant_id": merchant_id,
            "twin_ids": twin_ids,
            "status": "pending",
        }
    ).execute()

    background.add_task(
        run_swarm,
        run_id=run_id,
        twin_ids=twin_ids,
        merchant_id=merchant_id,
        kind=req.kind,
    )
    logger.info("dispatched %s swarm run=%s twins=%d", req.kind, run_id, len(twin_ids))
    return {"run_id": run_id, "kind": req.kind, "twin_count": len(twin_ids)}


@router.get("/runs")
async def list_runs(limit: int = 20) -> dict:
    resp = (
        supa()
        .table("swarm_runs")
        .select("id,kind,status,merchant_id,twin_ids,started_at,finished_at,error")
        .order("started_at", desc=True)
        .limit(min(limit, 100))
        .execute()
    )
    return {"runs": resp.data or []}


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    db = supa()
    run_resp = (
        db.table("swarm_runs")
        .select("id,kind,status,merchant_id,twin_ids,started_at,finished_at,error")
        .eq("id", run_id)
        .limit(1)
        .execute()
    )
    if not run_resp.data:
        raise HTTPException(status_code=404, detail="run not found")
    run = run_resp.data[0]

    reactions = (
        db.table("preset_reactions")
        .select("twin_id,preset_id,score_0_10,reasoning")
        .eq("run_id", run_id)
        .execute()
        .data
        or []
    )
    assignments = (
        db.table("twin_preset_assignments")
        .select("twin_id,merchant_id,preset_id,score_0_10,reasoning")
        .eq("run_id", run_id)
        .execute()
        .data
        or []
    )

    return {"run": run, "reactions": reactions, "assignments": assignments}
