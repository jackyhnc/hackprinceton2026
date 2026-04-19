"""Hand-crafted preset variant loader.

Since AI-generated hero HTML tends to look rough, the swarm no longer generates
HTML at runtime. Instead we keep a small library of hand-coded variants under
`packages/presets/<slug>/` and the cluster stage maps each cluster to one of
them by index. The cluster's own `display_name` / `tagline` / `change_summary`
still describe what it *meant*; the variant supplies the visible HTML + CSS.

Each variant dir contains:
  - meta.json   {slug, display_name, description, layout_family}
  - hero.html
  - hero.css

Loaded once at import time; cheap enough that we don't bother caching explicitly.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from config import REPO_ROOT

logger = logging.getLogger("twinstore.preset_library")

PRESETS_DIR = REPO_ROOT / "packages" / "presets"


def _load_one(variant_dir: Path) -> dict[str, Any] | None:
    meta_path = variant_dir / "meta.json"
    html_path = variant_dir / "hero.html"
    css_path = variant_dir / "hero.css"
    if not (meta_path.exists() and html_path.exists() and css_path.exists()):
        logger.warning("preset variant %s missing required file(s) — skipping", variant_dir.name)
        return None
    try:
        meta = json.loads(meta_path.read_text())
        return {
            "slug": meta["slug"],
            "display_name": meta["display_name"],
            "description": meta.get("description", ""),
            "layout_family": meta.get("layout_family", ""),
            "html": html_path.read_text().strip(),
            "css": css_path.read_text().strip(),
        }
    except Exception:
        logger.exception("failed to load preset variant %s", variant_dir.name)
        return None


def load_static_variants() -> list[dict[str, Any]]:
    """Return all variants under packages/presets/, sorted by folder name.

    Sort is stable so cluster-index → variant-index mapping is deterministic
    across restarts.
    """
    if not PRESETS_DIR.exists():
        logger.error("PRESETS_DIR does not exist: %s", PRESETS_DIR)
        return []
    variants: list[dict[str, Any]] = []
    for child in sorted(PRESETS_DIR.iterdir()):
        if not child.is_dir():
            continue
        loaded = _load_one(child)
        if loaded:
            variants.append(loaded)
    logger.info("loaded %d static preset variants", len(variants))
    return variants


# Module-level cache — safe because the files don't change at runtime.
STATIC_VARIANTS: list[dict[str, Any]] = load_static_variants()


def pick_variant_for_cluster(cluster_idx: int) -> dict[str, Any]:
    """Deterministic cluster-index → variant mapping. Wraps on overflow."""
    if not STATIC_VARIANTS:
        raise RuntimeError("no static preset variants loaded")
    return STATIC_VARIANTS[cluster_idx % len(STATIC_VARIANTS)]
