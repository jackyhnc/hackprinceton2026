from typing import Any

import httpx

from config import settings

_ENV_BASE = {
    "development": "https://development.knotapi.com",
    "production": "https://production.knotapi.com",
}


def base_url() -> str:
    return _ENV_BASE.get(settings.knot_environment, _ENV_BASE["development"])


def _auth() -> tuple[str, str]:
    return (settings.knot_client_id, settings.knot_secret)


async def create_session(external_user_id: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(
            f"{base_url()}/session/create",
            auth=_auth(),
            json={"type": "transaction_link", "external_user_id": external_user_id},
        )
        r.raise_for_status()
        return r.json()["session"]


async def sync_transactions(
    external_user_id: str, merchant_id: int, *, max_pages: int = 10
) -> list[dict[str, Any]]:
    """Pulls all transactions for (user, merchant) via Knot's cursor-paginated sync.

    Returns the flat list of transaction records. Raw shape passthrough — callers
    own field extraction.
    """
    transactions: list[dict[str, Any]] = []
    cursor: str | None = None

    async with httpx.AsyncClient(timeout=30.0) as c:
        for _ in range(max_pages):
            payload: dict[str, Any] = {
                "external_user_id": external_user_id,
                "merchant_id": merchant_id,
            }
            if cursor:
                payload["cursor"] = cursor
            r = await c.post(
                f"{base_url()}/transactions/sync",
                auth=_auth(),
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
            transactions.extend(data.get("transactions", []))
            cursor = data.get("next_cursor") or data.get("cursor")
            if not cursor:
                break
    return transactions
