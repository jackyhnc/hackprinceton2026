"""Swarm runner — runs inside a Dedalus container.

Receives {run_id, product, twins[], callback_url, k2_*} via env or stdin,
fans out per-twin reaction calls to K2 Think V2, posts each back to the
callback as it lands, then runs one consolidator call and posts the
final Action[].

This is a stub for M0 — wired up in M4.
"""

from __future__ import annotations

import json
import os
import sys


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    print(f"swarm-runner stub: received {len(payload.get('twins', []))} twins")
    print(f"callback_url: {payload.get('callback_url')}")
    print(f"k2_base_url: {os.environ.get('K2_BASE_URL', '<unset>')}")


if __name__ == "__main__":
    main()
