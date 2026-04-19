import json
import re

from openai import AsyncOpenAI

from config import settings

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.k2_api_key, base_url=settings.k2_base_url)
    return _client


def strip_reasoning(text: str) -> str:
    # K2 Think V2 emits a reasoning trace before a </think> sentinel.
    # Keep only what follows the final closing tag. If no tag is present,
    # assume the whole body is the answer.
    if "</think>" in text:
        return text.rsplit("</think>", 1)[1].strip()
    return text.strip()


def extract_json(text: str) -> dict:
    clean = strip_reasoning(text)
    start = clean.find("{")
    end = clean.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object in model output:\n{clean[:500]}")
    blob = clean[start : end + 1]
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        # retry after stripping trailing commas, a frequent LLM artifact
        blob = re.sub(r",\s*([}\]])", r"\1", blob)
        return json.loads(blob)


async def chat_json(system: str, user: str, *, max_tokens: int = 2000) -> dict:
    resp = await client().chat.completions.create(
        model=settings.k2_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
    )
    content = resp.choices[0].message.content or ""
    return extract_json(content)
