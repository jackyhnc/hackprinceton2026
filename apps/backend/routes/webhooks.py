import base64
import hashlib
import hmac
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

import knot
from config import settings
from db import supa
from swarm import run_swarm
from twin_minter import mint_twin

logger = logging.getLogger("twinstore.webhooks")
router = APIRouter()


def _verify_signature(request: Request, raw_body: bytes, payload: dict) -> bool:
    """Knot signs: Content-Length|<len>|Content-Type|<ct>|Encryption-Type|<enc>|event|<event>[|session_id|<sid>]
    HMAC-SHA256 with KNOT_WEBHOOK_SECRET, base64-encoded, header `Knot-Signature`."""
    signature = request.headers.get("knot-signature")
    if not settings.knot_webhook_secret:
        logger.warning("KNOT_WEBHOOK_SECRET is empty — skipping signature check (dev only)")
        return True
    if not signature:
        return False

    parts = [
        "Content-Length", request.headers.get("content-length") or "",
        "Content-Type", request.headers.get("content-type") or "",
        "Encryption-Type", request.headers.get("encryption-type") or "",
        "event", payload.get("event") or "",
    ]
    session_id = payload.get("session_id")
    if session_id:
        parts.extend(["session_id", session_id])

    expected = base64.b64encode(
        hmac.new(
            settings.knot_webhook_secret.encode(),
            "|".join(parts).encode(),
            hashlib.sha256,
        ).digest()
    ).decode()
    return hmac.compare_digest(expected, signature)


async def _mint_and_score(external_user_id: str, merchant_id: int, merchant_name: str) -> None:
    try:
        txns = await knot.sync_transactions(external_user_id, merchant_id)
        if not txns:
            logger.info("knot sync returned 0 txns for user=%s", external_user_id)
            return
        twin_id = await mint_twin(
            session_id=external_user_id,
            source_merchant=merchant_name,
            transactions=txns,
        )
        logger.info("minted twin %s from %d txns (user=%s)", twin_id, len(txns), external_user_id)
    except Exception:
        logger.exception("mint pipeline failed for user=%s", external_user_id)
        return

    # Auto-trigger mini-run: score this new twin against every preset for the demo merchant.
    try:
        db = supa()
        merchant_resp = db.table("merchants").select("id").limit(1).execute()
        if not merchant_resp.data:
            logger.warning("no merchant row — skipping mini-run for twin=%s", twin_id)
            return
        tsm_id = merchant_resp.data[0]["id"]

        run_id = str(uuid.uuid4())
        db.table("swarm_runs").insert(
            {
                "id": run_id,
                "kind": "mini",
                "merchant_id": tsm_id,
                "twin_ids": [twin_id],
                "status": "pending",
            }
        ).execute()
        await run_swarm(run_id=run_id, twin_ids=[twin_id], merchant_id=tsm_id)
        logger.info("mini-run %s done for twin=%s", run_id, twin_id)
    except Exception:
        logger.exception("mini-run dispatch failed for twin=%s", twin_id)


@router.post("/webhooks/knot")
async def knot_webhook(request: Request, background: BackgroundTasks) -> dict:
    body = await request.body()
    payload = await request.json()

    if not _verify_signature(request, body, payload):
        raise HTTPException(status_code=401, detail="bad signature")

    event = payload.get("event")
    external_user_id = payload.get("external_user_id")
    merchant = payload.get("merchant") or {}
    merchant_id = merchant.get("id")
    merchant_name = merchant.get("name") or "unknown"

    logger.info("knot webhook event=%s user=%s merchant=%s", event, external_user_id, merchant_id)

    if event == "NEW_TRANSACTIONS_AVAILABLE" and external_user_id and merchant_id:
        background.add_task(_mint_and_score, external_user_id, merchant_id, merchant_name)

    return {"received": True}
