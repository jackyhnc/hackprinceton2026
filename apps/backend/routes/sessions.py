import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

import knot
from config import settings
from routes.webhooks import _mint_and_score

router = APIRouter()


class SessionCreateResponse(BaseModel):
    session_id: str
    external_user_id: str


# Amazon merchant ID in Knot's system
AMAZON_MERCHANT_ID = 44


@router.post("/sessions", response_model=SessionCreateResponse)
async def create_session() -> SessionCreateResponse:
    external_user_id = f"twinstore-{uuid.uuid4().hex[:16]}"
    try:
        session_id = await knot.create_session(external_user_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"knot session/create failed: {e}")
    return SessionCreateResponse(
        session_id=session_id, external_user_id=external_user_id
    )


@router.post("/api/knot/session")
async def knot_session_for_storefront(request: Request) -> dict:
    """Storefront-facing session creation endpoint.

    Called directly by the Shopify theme block (bypassing the app proxy
    which points to example.com). Returns the full shape expected by
    the Knot SDK initialisation in the block.
    """
    external_user_id = f"twinstore-{uuid.uuid4().hex[:16]}"
    try:
        session_id = await knot.create_session(external_user_id)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"knot session/create failed: {e}",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    return {
        "sessionId": session_id,
        "externalUserId": external_user_id,
        "clientId": settings.knot_client_id,
        "environment": settings.knot_environment,
        "merchantIds": [AMAZON_MERCHANT_ID],
        "runtime": {
            "hasClientId": bool(settings.knot_client_id),
            "hasSecret": bool(settings.knot_secret),
        },
    }


@router.get("/api/knot/accounts")
async def knot_accounts(externalUserId: str, merchantName: str = "Amazon") -> dict:
    """Stub — returns success so the block's verifyKnotAccount check passes."""
    return {"linked": True, "externalUserId": externalUserId, "merchant": merchantName}


@router.get("/api/knot/discount")
async def knot_discount(externalUserId: str) -> dict:
    """Return any stored discount code for this user (currently a fixed demo code)."""
    return {"discountCode": "AMAZON5", "externalUserId": externalUserId}


class LinkCompleteRequest(BaseModel):
    external_user_id: str


@router.post("/api/knot/link-complete")
async def knot_link_complete(body: LinkCompleteRequest, background: BackgroundTasks) -> dict:
    """Called by the storefront immediately after Knot onExit to trigger the mint pipeline.

    Bypasses the Knot webhook (which doesn't fire reliably in dev) by directly
    kicking off sync_transactions → mint_twin → mini run_swarm as a background task.
    """
    background.add_task(_mint_and_score, body.external_user_id, AMAZON_MERCHANT_ID, "Amazon")
    return {"queued": True, "external_user_id": body.external_user_id}
