"""Dispatch a full swarm run synchronously from CLI.

Run from repo root:
    uv run --project apps/backend python apps/backend/scripts/run_full_swarm.py
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import supa  # noqa: E402
from swarm import run_swarm  # noqa: E402


async def main() -> None:
    db = supa()

    merchant = db.table("merchants").select("id,shop").limit(1).execute().data
    if not merchant:
        raise SystemExit("no merchant rows — seed a merchant first")
    merchant_id = merchant[0]["id"]
    print(f"merchant: {merchant[0]['shop']} ({merchant_id})")

    twins = db.table("twins").select("id").execute().data or []
    twin_ids = [t["id"] for t in twins]
    if not twin_ids:
        raise SystemExit("no twins — run seed_knot_mock_twins.py first")
    print(f"twins: {len(twin_ids)}")

    run_id = str(uuid.uuid4())
    db.table("swarm_runs").insert(
        {
            "id": run_id,
            "kind": "full",
            "merchant_id": merchant_id,
            "twin_ids": twin_ids,
            "status": "pending",
        }
    ).execute()
    print(f"run_id: {run_id}")

    await run_swarm(
        run_id=run_id,
        twin_ids=twin_ids,
        merchant_id=merchant_id,
        kind="full",
    )

    run = (
        db.table("swarm_runs")
        .select("status,error,finished_at")
        .eq("id", run_id)
        .limit(1)
        .execute()
        .data[0]
    )
    presets = (
        db.table("preset_library")
        .select("id,display_name,description,voter_twin_ids")
        .eq("run_id", run_id)
        .execute()
        .data
        or []
    )
    print(f"\nstatus: {run['status']}")
    if run.get("error"):
        print(f"error: {run['error']}")
    print(f"\npresets generated: {len(presets)}")
    for p in presets:
        voters = p.get("voter_twin_ids") or []
        print(f"  - {p['display_name']} ({p['id']}) — {len(voters)} voters")
        print(f"      {p['description']}")


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    asyncio.run(main())
