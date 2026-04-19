"""Swarm core — opinion → cluster → code pipeline via K2 Think V2.

Full run (merchant Run button):
  1. Per-twin fan-out: each twin emits 5-8 UI change opinions (twin_opinion.md).
  2. Single cluster call: group opinions into N coherent presets (preset_cluster.md).
  3. Per-preset fan-out: K2 coding agent generates self-contained HTML+CSS (preset_coder.md).
  4. Persist: wipe prior preset_library rows (cascade clears assignments/reactions),
     insert fresh preset rows, upsert twin_preset_assignments by voter_twin_ids.

Mini run (after twin mint): score the one new twin against existing presets via
preset_fit.md so it gets assigned without regenerating the whole library.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import REPO_ROOT
from db import supa
from k2 import chat_json

logger = logging.getLogger("twinstore.swarm")

PROMPT_DIR = REPO_ROOT / "packages" / "prompts"
K2_CONCURRENCY = 8
DEFAULT_CLUSTER_COUNT = 3


def _load_prompt(name: str) -> tuple[str, str]:
    raw = (PROMPT_DIR / name).read_text()
    sys_start = raw.index("## SYSTEM") + len("## SYSTEM")
    usr_start = raw.index("## USER")
    return raw[sys_start:usr_start].strip(), raw[usr_start + len("## USER") :].strip()


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return s or "preset"


async def _twin_opinion(
    system: str,
    user_template: str,
    twin: dict[str, Any],
    sem: asyncio.Semaphore,
) -> dict[str, Any]:
    async with sem:
        user = user_template.replace("{persona_doc}", twin["persona_doc"])
        try:
            result = await chat_json(system, user, max_tokens=2000)
            opinions = result.get("opinions") or []
            summary = str(result.get("summary_line", "")).strip()
        except Exception as e:
            logger.exception("twin_opinion failed for twin=%s", twin["id"])
            opinions = []
            summary = f"opinion failed: {e}"
        return {
            "twin_id": twin["id"],
            "display_name": twin.get("display_name", ""),
            "opinions": opinions,
            "summary_line": summary,
        }


async def _cluster_presets(
    system: str,
    user_template: str,
    twin_opinions: list[dict[str, Any]],
    cluster_count: int,
) -> list[dict[str, Any]]:
    blob_lines = []
    for t in twin_opinions:
        blob_lines.append(f"twin_id: {t['twin_id']}")
        blob_lines.append(f"  display_name: {t['display_name']}")
        blob_lines.append(f"  summary: {t['summary_line']}")
        for op in t["opinions"]:
            dim = op.get("dimension", "")
            stance = op.get("stance", "")
            why = op.get("why", "")
            blob_lines.append(f"  - {dim}: {stance} — {why}")
        blob_lines.append("")
    opinions_blob = "\n".join(blob_lines)

    user = user_template.replace("{opinions_blob}", opinions_blob).replace(
        "{target_cluster_count}", str(cluster_count)
    )
    result = await chat_json(system, user, max_tokens=4000)
    presets = result.get("presets") or []
    if len(presets) != cluster_count:
        logger.warning(
            "cluster returned %d presets, expected %d — continuing",
            len(presets),
            cluster_count,
        )
    return presets


async def _code_preset(
    system: str,
    user_template: str,
    preset: dict[str, Any],
    sem: asyncio.Semaphore,
) -> dict[str, str]:
    async with sem:
        user = (
            user_template.replace("{preset_name}", preset.get("name", ""))
            .replace("{preset_tagline}", preset.get("tagline", ""))
            .replace("{change_summary}", preset.get("change_summary", ""))
        )
        try:
            result = await chat_json(system, user, max_tokens=4000)
            html = str(result.get("html", "")).strip()
            css = str(result.get("css", "")).strip()
        except Exception as e:
            logger.exception("preset_coder failed for preset=%s", preset.get("name"))
            html = ""
            css = f"/* code generation failed: {e} */"
        return {"html": html, "css": css}


async def _score_single(
    system: str,
    user_template: str,
    twin: dict[str, Any],
    preset: dict[str, Any],
    sem: asyncio.Semaphore,
) -> dict[str, Any]:
    async with sem:
        description = preset.get("description") or preset.get("change_summary") or ""
        user = (
            user_template.replace("{persona_doc}", twin["persona_doc"])
            .replace("{preset_display_name}", preset["display_name"])
            .replace("{preset_description}", description)
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


async def _run_full(
    *,
    run_id: str,
    twins: list[dict[str, Any]],
    merchant_id: str,
    cluster_count: int,
) -> int:
    db = supa()
    op_sys, op_tpl = _load_prompt("twin_opinion.md")
    cl_sys, cl_tpl = _load_prompt("preset_cluster.md")
    co_sys, co_tpl = _load_prompt("preset_coder.md")

    sem = asyncio.Semaphore(K2_CONCURRENCY)

    logger.info("swarm run=%s stage=opinion twins=%d", run_id, len(twins))
    opinions = await asyncio.gather(
        *(_twin_opinion(op_sys, op_tpl, t, sem) for t in twins)
    )

    effective_k = min(cluster_count, max(1, len(twins)))
    logger.info("swarm run=%s stage=cluster k=%d", run_id, effective_k)
    presets = await _cluster_presets(cl_sys, cl_tpl, opinions, effective_k)
    if not presets:
        raise RuntimeError("clustering returned zero presets")

    logger.info("swarm run=%s stage=code presets=%d", run_id, len(presets))
    codes = await asyncio.gather(
        *(_code_preset(co_sys, co_tpl, p, sem) for p in presets)
    )

    run_prefix = run_id.split("-", 1)[0]
    preset_rows = []
    assignment_rows = []
    valid_twin_ids = {t["id"] for t in twins}

    for preset, code in zip(presets, codes):
        name = preset.get("name") or "Preset"
        tagline = preset.get("tagline") or ""
        change_summary = preset.get("change_summary") or ""
        voter_ids = [v for v in (preset.get("voter_twin_ids") or []) if v in valid_twin_ids]

        preset_id = f"{run_prefix}-{_slug(name)}"
        preset_rows.append(
            {
                "id": preset_id,
                "display_name": name,
                "description": tagline,
                "change_summary": change_summary,
                "generated_html": code["html"],
                "generated_css": code["css"],
                "voter_twin_ids": voter_ids,
                "run_id": run_id,
            }
        )
        for twin_id in voter_ids:
            assignment_rows.append(
                {
                    "twin_id": twin_id,
                    "merchant_id": merchant_id,
                    "preset_id": preset_id,
                    "score_0_10": None,
                    "reasoning": preset.get("tagline") or "cluster assignment",
                    "run_id": run_id,
                }
            )

    # Wipe prior preset rows (cascade clears assignments/reactions).
    db.table("preset_library").delete().neq("id", "__never__").execute()

    for i in range(0, len(preset_rows), 100):
        db.table("preset_library").insert(preset_rows[i : i + 100]).execute()

    # Cover any twins the cluster omitted — fall back to first preset.
    assigned = {a["twin_id"] for a in assignment_rows}
    fallback_preset_id = preset_rows[0]["id"]
    for t in twins:
        if t["id"] not in assigned:
            assignment_rows.append(
                {
                    "twin_id": t["id"],
                    "merchant_id": merchant_id,
                    "preset_id": fallback_preset_id,
                    "score_0_10": None,
                    "reasoning": "fallback: unassigned by cluster",
                    "run_id": run_id,
                }
            )

    for i in range(0, len(assignment_rows), 100):
        db.table("twin_preset_assignments").upsert(
            assignment_rows[i : i + 100], on_conflict="twin_id,merchant_id"
        ).execute()

    return len(assignment_rows)


async def _run_mini(
    *,
    run_id: str,
    twins: list[dict[str, Any]],
    merchant_id: str,
) -> int:
    """Score a single new twin against the current preset_library."""
    db = supa()
    fit_sys, fit_tpl = _load_prompt("preset_fit.md")

    presets = (
        db.table("preset_library")
        .select("id,display_name,description,change_summary")
        .execute()
        .data
        or []
    )
    if not presets:
        logger.info("swarm run=%s mini skipped: no presets in library", run_id)
        return 0

    sem = asyncio.Semaphore(K2_CONCURRENCY)
    pairs = [(t, p) for t in twins for p in presets]
    scores = await asyncio.gather(
        *(_score_single(fit_sys, fit_tpl, t, p, sem) for t, p in pairs)
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
    for i in range(0, len(reaction_rows), 100):
        db.table("preset_reactions").upsert(
            reaction_rows[i : i + 100], on_conflict="run_id,twin_id,preset_id"
        ).execute()

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

    return len(assignment_rows)


async def run_swarm(
    *,
    run_id: str,
    twin_ids: list[str],
    merchant_id: str,
    kind: str = "full",
    cluster_count: int = DEFAULT_CLUSTER_COUNT,
) -> None:
    """Dispatch a full (regenerate) or mini (assign-only) swarm run.

    Called as a FastAPI background task. Never raises — logs and flips
    swarm_runs.status to 'error' on failure.
    """
    db = supa()
    try:
        db.table("swarm_runs").update({"status": "running"}).eq("id", run_id).execute()

        twins_resp = (
            db.table("twins")
            .select("id,display_name,persona_doc")
            .in_("id", twin_ids)
            .execute()
        )
        twins = twins_resp.data or []
        if not twins:
            raise RuntimeError(f"no twins found for ids={twin_ids}")

        if kind == "mini":
            assignments = await _run_mini(
                run_id=run_id, twins=twins, merchant_id=merchant_id
            )
        else:
            assignments = await _run_full(
                run_id=run_id,
                twins=twins,
                merchant_id=merchant_id,
                cluster_count=cluster_count,
            )

        db.table("swarm_runs").update(
            {
                "status": "completed",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", run_id).execute()

        logger.info("swarm run=%s %s completed: %d assignments", run_id, kind, assignments)

    except Exception as e:
        logger.exception("swarm run=%s failed", run_id)
        db.table("swarm_runs").update(
            {
                "status": "error",
                "error": str(e),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", run_id).execute()
