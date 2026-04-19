"""Dedalus-powered twin opinion generation.

Each digital twin is run as a Dedalus agent that calls emit_opinion() 5-8 times
to express its storefront preferences. Replaces the raw chat_json K2 calls in
the opinion phase while keeping the same output shape the rest of the pipeline
expects.
"""
import asyncio
import logging
import random
from typing import Any

from dedalus_labs import AsyncDedalus, DedalusRunner

from config import settings
from swarm_events import publish as publish_event

logger = logging.getLogger("twinstore.dedalus_swarm")

_MODEL = "openai/gpt-4o-mini"

_INSTRUCTIONS = """You are a digital twin — a simulated shopper persona reviewing
an e-commerce storefront hero section. Based on your persona, you will suggest
specific UI and copy changes that would make the homepage more appealing to
shoppers like you.

Call emit_opinion() between 5 and 8 times. Each call should target a different
UI component (headline, subhead, CTA button, background, layout, trust signals,
offer/discount, imagery). Be specific and opinionated — your suggestions should
reflect your persona's values, price sensitivity, and shopping behaviour.

After all opinions are recorded, write a one-sentence summary of your overall
reaction to the current storefront."""


def _make_emit_tool(opinions: list[dict[str, Any]]):
    """Return an emit_opinion tool that appends to the shared opinions list."""

    def emit_opinion(component: str, proposed_change: str, reason: str) -> str:
        """Record a UI change opinion for a specific storefront component.

        Args:
            component: The UI element being evaluated (e.g. 'headline', 'CTA button',
                       'background colour', 'trust signals', 'discount offer').
            proposed_change: The specific change you would make to this component.
            reason: Why this change would appeal to shoppers like you.
        """
        opinions.append(
            {
                "component": component,
                "proposed_change": proposed_change,
                "reason": reason,
            }
        )
        return f"Opinion #{len(opinions)} recorded for '{component}'."

    return emit_opinion


async def _twin_opinion_dedalus(
    twin: dict[str, Any],
    sem: asyncio.Semaphore,
    run_id: str | None = None,
    stagger_s: float = 0.0,
) -> dict[str, Any]:
    """Run one twin as a Dedalus agent and collect its storefront opinions."""
    await asyncio.sleep(stagger_s + random.uniform(0, 1.5))

    async with sem:
        if run_id:
            publish_event(
                run_id,
                {
                    "stage": "opinion_start",
                    "twin_id": twin["id"],
                    "display_name": twin.get("display_name", ""),
                },
            )

        opinions: list[dict[str, Any]] = []
        emit_opinion = _make_emit_tool(opinions)

        prompt = (
            f"Your shopper persona:\n\n{twin['persona_doc']}\n\n"
            "You are reviewing this e-commerce storefront's hero section. "
            "Use emit_opinion to record your UI change suggestions, then summarise your reaction."
        )

        summary = ""
        try:
            client = AsyncDedalus(api_key=settings.dedalus_api_key)
            runner = DedalusRunner(client)
            result = await runner.run(
                input=prompt,
                instructions=_INSTRUCTIONS,
                model=_MODEL,
                tools=[emit_opinion],
                max_steps=12,
                max_tokens=1200,
            )
            summary = (result.final_output or "").strip()
        except Exception as e:
            logger.exception(
                "Dedalus opinion failed for twin=%s, falling back", twin["id"]
            )
            summary = f"opinion failed: {e}"

        if run_id:
            publish_event(
                run_id,
                {
                    "stage": "opinion_done",
                    "twin_id": twin["id"],
                    "display_name": twin.get("display_name", ""),
                    "summary": summary,
                    "opinion_count": len(opinions),
                },
            )

        return {
            "twin_id": twin["id"],
            "display_name": twin.get("display_name", ""),
            "opinions": opinions,
            "summary_line": summary,
        }


async def gather_twin_opinions(
    twins: list[dict[str, Any]],
    sem: asyncio.Semaphore,
    run_id: str | None = None,
) -> list[dict[str, Any]]:
    """Fan out Dedalus agent runs across all twins and collect opinions."""
    return await asyncio.gather(
        *(
            _twin_opinion_dedalus(t, sem, run_id=run_id, stagger_s=i * 0.8)
            for i, t in enumerate(twins)
        )
    )
