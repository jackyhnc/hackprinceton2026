import json
from collections import Counter
from pathlib import Path
from typing import Any

from config import REPO_ROOT
from db import supa
from k2 import chat_json

PROMPT_PATH = REPO_ROOT / "packages" / "prompts" / "twin_synthesis.md"


def _load_prompt() -> tuple[str, str]:
    raw = PROMPT_PATH.read_text()
    sys_marker = "## SYSTEM"
    usr_marker = "## USER"
    sys_start = raw.index(sys_marker) + len(sys_marker)
    usr_start = raw.index(usr_marker)
    system = raw[sys_start:usr_start].strip()
    user = raw[usr_start + len(usr_marker) :].strip()
    return system, user


def _to_cents(value: Any) -> int:
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return 0


def summarize_transactions(txns: list[dict[str, Any]]) -> dict[str, Any]:
    """Compress Knot transactions to a structured summary — no LLM involved.

    Knot's TransactionLink schema: each txn has `datetime`, `price.total`, a
    `price.adjustments[]` list (DISCOUNT/TAX/TIP/FEE/REFUND), `payment_methods[]`
    and `products[{name, quantity, seller{name}, price{unit_price}}]`. There is
    no category field — product-name frequency is what we pass to K2 instead.
    """
    product_counter: Counter[str] = Counter()
    seller_counter: Counter[str] = Counter()
    payment_type_counter: Counter[str] = Counter()
    total_cents = 0
    ticket_cents: list[int] = []
    dates: list[str] = []
    discount_txns = 0

    for t in txns:
        price = t.get("price") or {}
        cents = _to_cents(price.get("total"))
        total_cents += cents
        if cents > 0:
            ticket_cents.append(cents)

        for adj in price.get("adjustments") or []:
            if (adj.get("type") or "").upper() == "DISCOUNT":
                discount_txns += 1
                break

        date = t.get("datetime") or t.get("date")
        if isinstance(date, str):
            dates.append(date)

        for pm in t.get("payment_methods") or []:
            ptype = pm.get("type")
            if isinstance(ptype, str):
                payment_type_counter[ptype] += 1

        for product in t.get("products") or []:
            name = product.get("name")
            if isinstance(name, str) and name:
                product_counter[name] += 1
            seller = (product.get("seller") or {}).get("name")
            if isinstance(seller, str) and seller:
                seller_counter[seller] += 1

    avg_ticket_cents = sum(ticket_cents) // len(ticket_cents) if ticket_cents else 0
    discount_rate = discount_txns / len(txns) if txns else 0

    return {
        "txn_count": len(txns),
        "total_spend_cents": total_cents,
        "avg_ticket_cents": avg_ticket_cents,
        "discount_rate": round(discount_rate, 3),
        "top_products": [n for n, _ in product_counter.most_common(12)],
        "top_sellers": [n for n, _ in seller_counter.most_common(6)],
        "payment_mix": dict(payment_type_counter.most_common()),
        "date_range": {"earliest": min(dates), "latest": max(dates)} if dates else None,
        "sample_raw": txns[:3],
    }


async def synthesize_persona(summary: dict[str, Any]) -> dict[str, Any]:
    system, user_template = _load_prompt()
    user = user_template.replace("{summary}", json.dumps(summary, indent=2))
    return await chat_json(system, user, max_tokens=3000)


async def mint_twin(
    *,
    session_id: str,
    source_merchant: str,
    transactions: list[dict[str, Any]],
) -> str:
    summary = summarize_transactions(transactions)
    persona = await synthesize_persona(summary)

    display_name = persona.get("display_name") or "Anonymous Shopper"
    persona_doc = persona.get("persona_doc") or ""
    hint = persona.get("price_sensitivity_hint", "mid")
    if hint not in ("low", "mid", "high"):
        hint = "mid"

    resp = (
        supa()
        .table("twins")
        .insert(
            {
                "source_session_id": session_id,
                "source_merchant": source_merchant,
                "raw_txn_count": len(transactions),
                "raw_summary": summary,
                "persona_doc": persona_doc,
                "display_name": display_name,
                "price_sensitivity_hint": hint,
            }
        )
        .execute()
    )
    return resp.data[0]["id"]
