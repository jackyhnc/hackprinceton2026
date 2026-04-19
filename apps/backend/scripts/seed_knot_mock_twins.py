"""Seed twins driven by Knot's dev /development/link-account.

For each mock external_user_id we:
  1. POST /merchant/list     (once)  — find Amazon's merchant_id
  2. POST /development/link-account   — Knot fabricates realistic transactions
  3. POST /transactions/sync          — pull those transactions back
  4. mint_twin()                      — summarize + K2 persona synth + insert
  5. customer_twin_link               — wire twin to the first local merchant

Run from repo root:
    uv run --project apps/backend python apps/backend/scripts/seed_knot_mock_twins.py
"""
from __future__ import annotations

import asyncio
import random
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from config import settings  # noqa: E402
from db import supa  # noqa: E402
from knot import base_url, sync_transactions  # noqa: E402
from twin_minter import mint_twin  # noqa: E402


MERCHANT_NAME = "Amazon"
MOCK_USER_COUNT = 10
TXN_MIN = 20
TXN_MAX = 50


def _auth() -> tuple[str, str]:
    return (settings.knot_client_id, settings.knot_secret)


async def find_merchant(client: httpx.AsyncClient, name: str) -> dict:
    r = await client.post(
        f"{base_url()}/merchant/list",
        auth=_auth(),
        json={"type": "transaction_link", "platform": "web", "search": name},
    )
    r.raise_for_status()
    data = r.json()
    merchants = data if isinstance(data, list) else [data]
    match = next(
        (m for m in merchants if name.lower() in (m.get("name") or "").lower()),
        None,
    )
    if not match:
        raise SystemExit(f"no {name} merchant found in /merchant/list response")
    return match


async def link_account(
    client: httpx.AsyncClient, external_user_id: str, merchant_id: int
) -> None:
    r = await client.post(
        f"{base_url()}/development/accounts/link",
        auth=_auth(),
        json={
            "external_user_id": external_user_id,
            "merchant_id": merchant_id,
            "transactions": {"new": True},
        },
    )
    if r.status_code >= 400:
        raise RuntimeError(
            f"link-account failed ({r.status_code}): {r.text}"
        )


async def seed_one(
    client: httpx.AsyncClient,
    *,
    external_user_id: str,
    merchant_id: int,
    merchant_name: str,
    local_merchant_id: str,
) -> str | None:
    print(f"\n--- {external_user_id} ---")
    print("  linking account…")
    await link_account(client, external_user_id, merchant_id)

    print("  syncing transactions…")
    txns: list = []
    for attempt in range(12):
        txns = await sync_transactions(external_user_id, merchant_id)
        if txns:
            break
        await asyncio.sleep(2.5)
        print(f"    retry {attempt + 1}/12 (still 0 txns)…")
    if not txns:
        print("  no transactions after 30s, skipping")
        return None

    target = random.randint(TXN_MIN, TXN_MAX)
    if len(txns) > target:
        txns = random.sample(txns, target)
    print(f"  got {len(txns)} txns (target {target}), minting twin…")

    twin_id = await mint_twin(
        session_id=external_user_id,
        source_merchant=merchant_name,
        transactions=txns,
    )
    print(f"  twin id: {twin_id}")

    supa().table("customer_twin_link").upsert(
        {
            "merchant_id": local_merchant_id,
            "shopify_customer_id": f"mock-{external_user_id}",
            "twin_id": twin_id,
        },
        on_conflict="merchant_id,shopify_customer_id",
    ).execute()
    return twin_id


async def main() -> None:
    if not settings.knot_client_id or not settings.knot_secret:
        raise SystemExit("KNOT_CLIENT_ID / KNOT_SECRET missing from .env")
    if not settings.k2_api_key:
        raise SystemExit("K2_API_KEY missing from .env (needed for persona synth)")

    merchant_resp = supa().table("merchants").select("id,shop").limit(1).execute()
    if not merchant_resp.data:
        raise SystemExit(
            "No row in merchants table. Install the Shopify app on a dev store first."
        )
    local_merchant_id = merchant_resp.data[0]["id"]
    shop = merchant_resp.data[0]["shop"]
    print(f"local merchant: {shop} ({local_merchant_id})")

    async with httpx.AsyncClient(timeout=30.0) as client:
        merchant = await find_merchant(client, MERCHANT_NAME)
        merchant_id = merchant["id"]
        merchant_name = merchant.get("name") or MERCHANT_NAME
        print(f"knot merchant: {merchant_name} (id={merchant_id})")

        minted: list[str] = []
        for _ in range(MOCK_USER_COUNT):
            ext_id = f"mock-{uuid.uuid4().hex[:12]}"
            try:
                twin_id = await seed_one(
                    client,
                    external_user_id=ext_id,
                    merchant_id=merchant_id,
                    merchant_name=merchant_name,
                    local_merchant_id=local_merchant_id,
                )
            except Exception as e:
                print(f"  FAILED: {e}")
                continue
            if twin_id:
                minted.append(twin_id)

    print(f"\nDone. minted {len(minted)} twin(s) via Knot dev link-account.")
    if minted:
        print("\nNext: run the swarm to score them against the 4 presets:")
        print("  curl -X POST http://localhost:8000/swarm/run "
              "-H 'Content-Type: application/json' \\")
        print(f"    -d '{{\"shop\": \"{shop}\", \"kind\": \"full\"}}'")


if __name__ == "__main__":
    asyncio.run(main())
