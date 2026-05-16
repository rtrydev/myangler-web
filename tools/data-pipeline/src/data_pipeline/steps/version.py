"""Version stamp step (spec §3.3 / §5.2).

Emits a tiny JSON file shipped alongside the data assets. The frontend
sync script reads it and bakes the resulting stamp into the
fingerprinted SQLite filename so a new dictionary build forces every
browser past its HTTP cache automatically (see
``app/lib/lookup/scripts/sync-assets.mjs``).

Scheme: integer Unix timestamp in seconds (UTC). Sortable, opaque, and
short enough to embed in a URL without ceremony.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from data_pipeline.config import VERSION_SCHEME

logger = logging.getLogger(__name__)


def build_version_string(now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return str(int(moment.timestamp()))


def write_version_stamp(path: Path, version: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": version, "scheme": VERSION_SCHEME}
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
        fh.write("\n")
    return path.stat().st_size
