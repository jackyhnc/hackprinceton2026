"""In-memory pub/sub for swarm pipeline events.

The swarm coroutine `publish()`es events while running; SSE subscribers
read them via `subscribe(run_id)`. Everything is asyncio.Queue-based —
no Redis, no persistence. If the backend restarts mid-run, the live
graph resets but the run continues writing to Supabase as normal.

Each event is a dict like:
    {"stage": "opinion", "twin_id": "...", "summary": "..."}
    {"stage": "cluster_edge", "twin_id": "...", "cluster_id": "..."}
    {"stage": "preset_coded", "preset_id": "...", "display_name": "..."}
    {"stage": "done"}  # sentinel — subscribers disconnect on this

Subscribers are per-run-id. Multiple browser tabs = multiple subscribers
of the same queue list.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

# run_id → list of subscriber queues
_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)
# run_id → list of events we've seen (so late subscribers can replay)
_history: dict[str, list[dict[str, Any]]] = defaultdict(list)
_HISTORY_CAP = 500


def publish(run_id: str, event: dict[str, Any]) -> None:
    """Non-blocking fan-out of an event to all subscribers of run_id."""
    hist = _history[run_id]
    hist.append(event)
    if len(hist) > _HISTORY_CAP:
        del hist[: len(hist) - _HISTORY_CAP]
    for q in list(_subscribers.get(run_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # drop event on this subscriber rather than block the producer
            pass


def subscribe(run_id: str) -> asyncio.Queue:
    """Returns a fresh queue pre-loaded with historical events so a new
    subscriber sees the whole run from the start."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    for e in _history.get(run_id, []):
        try:
            q.put_nowait(e)
        except asyncio.QueueFull:
            break
    _subscribers[run_id].append(q)
    return q


def unsubscribe(run_id: str, q: asyncio.Queue) -> None:
    subs = _subscribers.get(run_id)
    if not subs:
        return
    try:
        subs.remove(q)
    except ValueError:
        pass
    if not subs:
        _subscribers.pop(run_id, None)


def clear_run(run_id: str) -> None:
    """Drop the history for a run. Call from tests only."""
    _history.pop(run_id, None)
