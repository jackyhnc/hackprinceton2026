from fastapi import APIRouter, HTTPException

from db import supa

router = APIRouter()

PUBLIC_COLS = "id,display_name,source_merchant,raw_txn_count,persona_doc,price_sensitivity_hint,created_at"


@router.get("/twins")
async def list_twins(limit: int = 50) -> dict:
    resp = (
        supa()
        .table("twins")
        .select(PUBLIC_COLS)
        .order("created_at", desc=True)
        .limit(min(limit, 200))
        .execute()
    )
    return {"twins": resp.data}


@router.get("/twins/by-session/{session_id}")
async def get_twin_by_session(session_id: str) -> dict:
    resp = (
        supa()
        .table("twins")
        .select(PUBLIC_COLS)
        .eq("source_session_id", session_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return {"twin": None}
    return {"twin": resp.data[0]}


@router.get("/twins/{twin_id}")
async def get_twin(twin_id: str) -> dict:
    resp = (
        supa()
        .table("twins")
        .select(PUBLIC_COLS + ",raw_summary")
        .eq("id", twin_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="twin not found")
    return resp.data[0]
