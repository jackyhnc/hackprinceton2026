"""Swarm core — per-twin preset-fit scoring via K2 Think V2.

The swarm is embarrassingly parallel: each (twin, preset) pair is one
independent K2 call. We fan out with asyncio.gather under a semaphore to
respect upstream rate limits, write every score into preset_reactions, then
upsert the winning preset per twin into twin_preset_assignments.

Two modes:
- mini: one twin, all presets (triggered automatically on new twin mint)
- full: all twins, all presets (triggered by the merchant's Run button)
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from config import REPO_ROOT
from db import supa
from k2 import chat_json

logger = logging.getLogger("twinstore.swarm")

PROMPT_PATH = REPO_ROOT / "packages" / "prompts" / "preset_fit.md"
K2_CONCURRENCY = 8


def _load_prompt() -> tuple[str, str]:
    raw = PROMPT_PATH.read_text()
    sys_start = raw.index("## SYSTEM") + len("## SYSTEM")
    usr_start = raw.index("## USER")
    return raw[sys_start:usr_start].strip(), raw[usr_start + len("## USER") :].strip()


async def _score_one(
    system: str,
    user_template: str,
    twin: dict[str, Any],
    preset: dict[str, Any],
    sem: asyncio.Semaphore,
) -> dict[str, Any]:
    async with sem:
        user = (
            user_template.replace("{persona_doc}", twin["persona_doc"])
            .replace("{preset_display_name}", preset["display_name"])
            .replace("{preset_description}", preset["description"])
        )
        try:
            result = await chat_json(system, user, max_tokens=1500)
            score = float(result.get("score_0_10", 5))
            reasoning = str(result.get("reasoning", "")).strip()
        except Exception as e:
            logger.exception(
                "preset_fit failed for twin=%s preset=%s", twin["id"], preset["id"]
            )
            score = 0.0
            reasoning = f"scoring failed: {e}"
        return {
            "twin_id": twin["id"],
            "preset_id": preset["id"],
            "score_0_10": score,
            "reasoning": reasoning,
        }


async def run_swarm(
    *,
    run_id: str,
    twin_ids: list[str],
    merchant_id: str,
) -> None:
    """Score every (twin, preset) pair for a run and write results.

    Called as a FastAPI background task. Updates swarm_runs status through
    the lifecycle. Never raises — logs exceptions and flips status to 'error'.
    """
    db = supa()
    system, user_template = _load_prompt()

    try:
        db.table("swarm_runs").update({"status": "running"}).eq("id", run_id).execute()

        twins_resp = (
            db.table("twins")
            .select("id,display_name,persona_doc")
            .in_("id", twin_ids)
            .execute()
        )
        twins = twins_resp.data or []
        presets = (
            db.table("preset_library")
            .select("id,display_name,description")
            .execute()
            .data
            or []
        )

        if not twins or not presets:
            raise RuntimeError(f"nothing to score: twins={len(twins)} presets={len(presets)}")

        logger.info(
            "swarm run=%s scoring %d twins x %d presets = %d calls",
            run_id,
            len(twins),
            len(presets),
            len(twins) * len(presets),
        )

        sem = asyncio.Semaphore(K2_CONCURRENCY)
        pairs = [(t, p) for t in twins for p in presets]
        scores = await asyncio.gather(
            *(_score_one(system, user_template, t, p, sem) for t, p in pairs)
        )

        reaction_rows = [
            {
                "run_id": run_id,
                "twin_id": s["twin_id"],
                "preset_id": s["preset_id"],
                "score_0_10": s["score_0_10"],
                "reasoning": s["reasoning"],
            }
            for s in scores
        ]
        # Chunk to stay under Supabase row limits
        for i in range(0, len(reaction_rows), 100):
            db.table("preset_reactions").upsert(
                reaction_rows[i : i + 100], on_conflict="run_id,twin_id,preset_id"
            ).execute()

        # Pick winner per twin
        by_twin: dict[str, list[dict[str, Any]]] = {}
        for s in scores:
            by_twin.setdefault(s["twin_id"], []).append(s)

        assignment_rows = []
        for twin_id, group in by_twin.items():
            winner = max(group, key=lambda g: g["score_0_10"])
            assignment_rows.append(
                {
                    "twin_id": twin_id,
                    "merchant_id": merchant_id,
                    "preset_id": winner["preset_id"],
                    "score_0_10": winner["score_0_10"],
                    "reasoning": winner["reasoning"],
                    "run_id": run_id,
                }
            )
        for i in range(0, len(assignment_rows), 100):
            db.table("twin_preset_assignments").upsert(
                assignment_rows[i : i + 100], on_conflict="twin_id,merchant_id"
            ).execute()

        db.table("swarm_runs").update(
            {
                "status": "completed",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", run_id).execute()

        logger.info("swarm run=%s completed: %d assignments", run_id, len(assignment_rows))

    except Exception as e:
        logger.exception("swarm run=%s failed", run_id)
        db.table("swarm_runs").update(
            {
                "status": "error",
                "error": str(e),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", run_id).execute()
