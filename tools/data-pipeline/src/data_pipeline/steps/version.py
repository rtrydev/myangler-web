"""Version stamp step (spec §3.3 / §5.2).

Emits a tiny JSON file shipped alongside the data assets. The service
worker reads it to detect stale caches: when the string differs from the
last seen value it triggers a full asset re-fetch (§5.2).

Scheme: a UTC build timestamp formatted by
:data:`~data_pipeline.config.VERSION_STAMP_FORMAT` (``YYYYMMDDTHHMMSSZ``).
Sortable, no external inputs required, stable across machines for a given
build moment. Documented in README.md.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from data_pipeline.config import VERSION_STAMP_FORMAT

logger = logging.getLogger(__name__)


def build_version_string(now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime(VERSION_STAMP_FORMAT)


def write_version_stamp(path: Path, version: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": version, "scheme": "utc-timestamp/v1"}
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
        fh.write("\n")
    return path.stat().st_size
