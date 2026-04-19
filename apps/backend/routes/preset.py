"""Preset lookup for the storefront App Embed.

On every page load the App Embed hits /preset-for-customer/:id (signed in)
or /preset-for-session/:external_user_id (anonymous) to get the twin's
assigned preset. Pure DB lookup — no LLM, <10ms target — because the swarm
has already scored offline.

Signup flow: App Embed starts a Knot session → shopper completes link →
Knot webhook mints twin and runs mini swarm → App Embed polls preset-for-session.
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import supa

logger = logging.getLogger("twinstore.routes.preset")
router = APIRouter()


class CustomerLinkRequest(BaseModel):
    shopify_customer_id: str
    session_id: str
    shop: str | None = None


def _merchant_id_for(shop: str | None) -> str:
    db = supa()
    if shop:
        resp = db.table("merchants").select("id").eq("shop", shop).limit(1).execute()
        if resp.data:
            return resp.data[0]["id"]
    resp = db.table("merchants").select("id").limit(1).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="no merchant configured")
    return resp.data[0]["id"]


def _build_response(merchant_id: str, twin_id: str) -> dict:
    db = supa()
    assign_resp = (
        db.table("twin_preset_assignments")
        .select("preset_id,score_0_10,reasoning")
        .eq("merchant_id", merchant_id)
        .eq("twin_id", twin_id)
        .limit(1)
        .execute()
    )
    if not assign_resp.data:
        return {"preset": None, "twin": {"id": twin_id}, "reason": "scoring_pending"}
    assignment = assign_resp.data[0]

    preset_resp = (
        db.table("preset_library")
        .select("id,display_name,description,config")
        .eq("id", assignment["preset_id"])
        .limit(1)
        .execute()
    )
    if not preset_resp.data:
        return {"preset": None, "twin": {"id": twin_id}, "reason": "preset_missing"}
    preset = preset_resp.data[0]

    twin_resp = (
        db.table("twins")
        .select("id,display_name,price_sensitivity_hint")
        .eq("id", twin_id)
        .limit(1)
        .execute()
    )
    twin = twin_resp.data[0] if twin_resp.data else {"id": twin_id}

    return {
        "preset": {
            "id": preset["id"],
            "display_name": preset["display_name"],
            "config": preset["config"],
        },
        "twin": twin,
        "assignment": {
            "score_0_10": assignment["score_0_10"],
            "reasoning": assignment["reasoning"],
        },
    }


@router.post("/customer-link")
async def link_customer(req: CustomerLinkRequest) -> dict:
    db = supa()
    twin_resp = (
        db.table("twins")
        .select("id,display_name")
        .eq("source_session_id", req.session_id)
        .limit(1)
        .execute()
    )
    if not twin_resp.data:
        raise HTTPException(status_code=404, detail="no twin for session")
    twin = twin_resp.data[0]
    merchant_id = _merchant_id_for(req.shop)

    db.table("customer_twin_link").upsert(
        {
            "merchant_id": merchant_id,
            "shopify_customer_id": req.shopify_customer_id,
            "twin_id": twin["id"],
        },
        on_conflict="merchant_id,shopify_customer_id",
    ).execute()

    logger.info(
        "linked shopify_customer=%s to twin=%s (%s)",
        req.shopify_customer_id,
        twin["id"],
        twin["display_name"],
    )
    return {"twin_id": twin["id"], "display_name": twin["display_name"]}


@router.get("/preset-for-customer/{shopify_customer_id}")
async def preset_for_customer(shopify_customer_id: str, shop: str | None = None) -> dict:
    db = supa()
    merchant_id = _merchant_id_for(shop)
    link_resp = (
        db.table("customer_twin_link")
        .select("twin_id")
        .eq("merchant_id", merchant_id)
        .eq("shopify_customer_id", shopify_customer_id)
        .limit(1)
        .execute()
    )
    if not link_resp.data:
        return {"preset": None, "twin": None, "reason": "unlinked"}
    return _build_response(merchant_id, link_resp.data[0]["twin_id"])


@router.get("/preset-for-session/{session_id}")
async def preset_for_session(session_id: str, shop: str | None = None) -> dict:
    db = supa()
    twin_resp = (
        db.table("twins")
        .select("id")
        .eq("source_session_id", session_id)
        .limit(1)
        .execute()
    )
    if not twin_resp.data:
        return {"preset": None, "twin": None, "reason": "twin_not_yet_minted"}
    merchant_id = _merchant_id_for(shop)
    return _build_response(merchant_id, twin_resp.data[0]["id"])
