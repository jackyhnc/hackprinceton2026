"""OpenAI GPT client for HTML/CSS codegen.

Separate from k2.py because we send to OpenAI's real endpoint, not the K2 proxy.
Only the preset-coder stage uses this — opinion + cluster stages stay on K2.
"""
import json
import re

from openai import AsyncOpenAI

from config import settings

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def extract_json(text: str) -> dict:
    """Strip fences + trailing commas, find the first JSON object."""
    clean = text.strip()
    # Remove ```json ... ``` fences if present
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", clean, re.DOTALL)
    if fence:
        clean = fence.group(1).strip()
    start = clean.find("{")
    end = clean.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object in GPT output:\n{clean[:500]}")
    blob = clean[start : end + 1]
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        blob = re.sub(r",\s*([}\]])", r"\1", blob)
        return json.loads(blob)


async def chat_json_gpt(system: str, user: str, *, max_tokens: int = 8000) -> dict:
    """Ask GPT for a JSON-shaped response. Uses response_format=json_object so
    the model is guaranteed to return valid JSON (saves us a retry loop).

    Reasoning models (o1, gpt-5.*) require `max_completion_tokens` instead of
    the older `max_tokens` — we try the new param first and fall back if the
    API rejects it.
    """
    model = settings.openai_model
    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "max_completion_tokens": max_tokens,
    }
    try:
        resp = await client().chat.completions.create(**kwargs)
    except Exception as exc:
        msg = str(exc)
        # older models reject max_completion_tokens, newer models reject max_tokens.
        if "max_completion_tokens" in msg:
            kwargs.pop("max_completion_tokens")
            kwargs["max_tokens"] = max_tokens
            resp = await client().chat.completions.create(**kwargs)
        else:
            raise
    content = resp.choices[0].message.content or ""
    return extract_json(content)
