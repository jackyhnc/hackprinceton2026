from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import supa

router = APIRouter(prefix="/dashboard")


class DiscountPolicyUpdate(BaseModel):
    enabled: bool = True
    max_pct: int = Field(ge=0, le=100)
    daily_budget_cents: int = Field(ge=0)
    cooldown_minutes: int = Field(ge=0)


def _merchant_row() -> dict:
    resp = (
        supa()
        .table("merchants")
        .select("id,shop,discount_config,installed_at")
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="no merchant configured")
    return resp.data[0]


def _count(query) -> int:
    resp = query.execute()
    return int(resp.count or 0)


@router.get("/overview")
async def dashboard_overview() -> dict:
    db = supa()
    merchant = _merchant_row()
    merchant_id = merchant["id"]

    linked_user_count = _count(
        db.table("customer_twin_link")
        .select("merchant_id", count="exact", head=True)
        .eq("merchant_id", merchant_id)
    )
    assigned_twin_count = _count(
        db.table("twin_preset_assignments")
        .select("merchant_id", count="exact", head=True)
        .eq("merchant_id", merchant_id)
    )
    preset_count = _count(
        db.table("preset_library").select("id", count="exact", head=True)
    )
    run_count = _count(
        db.table("swarm_runs")
        .select("id", count="exact", head=True)
        .eq("merchant_id", merchant_id)
    )

    recent_runs = (
        db.table("swarm_runs")
        .select("id,kind,status,started_at,finished_at,error")
        .eq("merchant_id", merchant_id)
        .order("started_at", desc=True)
        .limit(6)
        .execute()
        .data
        or []
    )

    recent_links = (
        db.table("customer_twin_link")
        .select("shopify_customer_id,twin_id,linked_at")
        .eq("merchant_id", merchant_id)
        .order("linked_at", desc=True)
        .limit(8)
        .execute()
        .data
        or []
    )

    twin_map = {}
    twin_ids = [row["twin_id"] for row in recent_links if row.get("twin_id")]
    if twin_ids:
        twins = (
            db.table("twins")
            .select("id,display_name,raw_txn_count,price_sensitivity_hint")
            .in_("id", twin_ids)
            .execute()
            .data
            or []
        )
        twin_map = {twin["id"]: twin for twin in twins}

    recent_users = [
        {
            "shopify_customer_id": row["shopify_customer_id"],
            "linked_at": row["linked_at"],
            "twin": twin_map.get(row["twin_id"], {"id": row["twin_id"]}),
        }
        for row in recent_links
    ]

    presets = (
        db.table("preset_library")
        .select(
            "id,display_name,description,change_summary,voter_twin_ids,generated_html,generated_css,created_at"
        )
        .order("created_at", desc=True)
        .limit(6)
        .execute()
        .data
        or []
    )

    return {
        "merchant": merchant,
        "overview": {
            "linked_user_count": linked_user_count,
            "assigned_twin_count": assigned_twin_count,
            "preset_count": preset_count,
            "run_count": run_count,
        },
        "recent_runs": recent_runs,
        "recent_users": recent_users,
        "presets": presets,
    }


@router.get("/discount-policy")
async def get_discount_policy() -> dict:
    merchant = _merchant_row()
    return {
        "merchant_id": merchant["id"],
        "shop": merchant["shop"],
        "discount_config": merchant.get("discount_config") or {},
    }


@router.put("/discount-policy")
async def update_discount_policy(payload: DiscountPolicyUpdate) -> dict:
    merchant = _merchant_row()
    updated = (
        supa()
        .table("merchants")
        .update({"discount_config": payload.model_dump()})
        .eq("id", merchant["id"])
        .execute()
    )
    row = updated.data[0] if updated.data else None
    return {
        "merchant_id": merchant["id"],
        "shop": merchant["shop"],
        "discount_config": (row or {}).get("discount_config", payload.model_dump()),
    }
