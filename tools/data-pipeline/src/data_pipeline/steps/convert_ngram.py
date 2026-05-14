"""N-gram conversion step (spec §6.6).

The myWord segmenter ships its unigram + bigram dictionaries as **pickled
Python binaries** (``unigram-word.bin`` / ``bigram-word.bin``), which the
JavaScript Viterbi port (spec §4.2) cannot read. This step converts them
once, at build time, into a single JSON asset (``ngram.json``) the
frontend can ``fetch()`` directly.

The conversion is **faithful** — every n-gram and its associated count is
preserved. No pruning, thresholding, or downsampling: those decisions are
deferred to a later task and will be made against the sizes this step
reports (see ``steps/report.py``). The phrase-level pickles myWord also
ships are intentionally **not** converted — the spec only ports the
*word* Viterbi segmenter (§2.2 / §4.2), and the phrase data would roughly
quadruple the precache payload for a feature the app does not expose.

### Pickle structure (verified by inspection of ``dict_ver1/`` v1)

* ``unigram-word.bin`` is a ``defaultdict(int)`` keyed by the unigram
  word string (Burmese ``str``); values are raw integer counts.
* ``bigram-word.bin`` is a ``defaultdict(int)`` keyed by a
  ``tuple[str, str]`` of ``(prev_word, curr_word)``; values are raw
  integer counts. (Upstream ``myWord/word_segment.py`` looked these up
  by ``"prev curr"`` strings — a bug that left bigrams loaded but
  never consulted. The repo's corrected reference at
  ``tools/data-pipeline/reference/myword/word_segment.py`` and the JS
  port at ``app/lib/segmenter/wordSegmenter.ts`` both fix it; this
  conversion step preserves the on-disk tuple shape unchanged.)

### Output format (frontend contract)

JSON, UTF-8, single object — see README.md for the full schema. The
shape:

* top-level metadata (format tag, source filenames, n-gram counts,
  totals);
* ``unigram``: ``{word: count}``;
* ``bigram``: ``{prev_word: {curr_word: count}}`` — a 2-level nested
  object so the tuple keys round-trip cleanly through JSON.

### Trusted input

Python's :mod:`pickle` can execute arbitrary code on load. The myWord
pickles come from the trusted upstream repository; this loader still
restricts the unpickler to a small whitelist of expected classes
(:class:`_SafeUnpickler`) so a tampered file fails loudly instead of
running code. Do **not** route untrusted pickle paths through this
module.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import pickle
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from data_pipeline.config import (
    NGRAM_BIGRAM_FILENAME,
    NGRAM_FILENAME,
    NGRAM_UNIGRAM_FILENAME,
)

logger = logging.getLogger(__name__)

NGRAM_FORMAT_TAG: str = "myword-ngram/v1"


class MissingNgramInputError(FileNotFoundError):
    """Raised when one of the required myWord pickle files is absent.

    Carries an actionable message describing which file is missing and
    where it must be placed; the CLI prints this verbatim instead of a
    stack trace.
    """


class CorruptNgramInputError(ValueError):
    """Raised when a pickle loads but its shape is not the expected
    ``(prev, curr) -> int`` / ``str -> int`` mapping."""


_ALLOWED_PICKLE_CLASSES: dict[tuple[str, str], type] = {
    ("collections", "defaultdict"): defaultdict,
    ("builtins", "dict"): dict,
    ("builtins", "int"): int,
    ("builtins", "str"): str,
    ("builtins", "tuple"): tuple,
    ("builtins", "list"): list,
}


class _SafeUnpickler(pickle.Unpickler):
    """Unpickler that only permits the small class set the myWord
    dictionaries actually use. Anything else raises ``UnpicklingError``
    rather than executing arbitrary code."""

    def find_class(self, module: str, name: str) -> Any:  # noqa: D401
        cls = _ALLOWED_PICKLE_CLASSES.get((module, name))
        if cls is None:
            raise pickle.UnpicklingError(
                f"refusing to load disallowed pickle global: {module}.{name}"
            )
        return cls


@dataclass
class NgramStats:
    """Summary of the n-gram conversion."""

    unigram_count: int = 0
    unigram_total: int = 0
    bigram_count: int = 0
    bigram_total: int = 0
    raw_unigram_size: int = 0
    raw_bigram_size: int = 0
    output_size: int = 0
    output_size_gzipped: int = 0
    source_unigram: Path = field(default_factory=Path)
    source_bigram: Path = field(default_factory=Path)


def _require_input_file(path: Path, kind: str) -> None:
    if not path.exists():
        raise MissingNgramInputError(
            f"required myWord {kind} pickle not found: {path}\n"
            f"Place the merged myWord ``dict_ver1/{path.name}`` file there "
            f"(see tools/data-pipeline/README.md for instructions)."
        )


def _load_pickle(path: Path) -> Any:
    with path.open("rb") as fh:
        return _SafeUnpickler(fh).load()


def _coerce_unigram(obj: Any, source: Path) -> dict[str, int]:
    """Validate and re-key the unigram pickle into a plain dict."""
    if not isinstance(obj, dict):
        raise CorruptNgramInputError(
            f"{source}: expected dict-like unigram pickle, got {type(obj).__name__}"
        )
    out: dict[str, int] = {}
    for key, value in obj.items():
        if not isinstance(key, str):
            raise CorruptNgramInputError(
                f"{source}: unigram key is {type(key).__name__}, expected str"
            )
        if not isinstance(value, int):
            raise CorruptNgramInputError(
                f"{source}: unigram value for {key!r} is {type(value).__name__}, expected int"
            )
        out[key] = value
    return out


def _coerce_bigram(obj: Any, source: Path) -> dict[str, dict[str, int]]:
    """Validate and re-shape the bigram pickle into a nested dict.

    The pickle is keyed by ``(prev, curr)`` tuples; we group by ``prev``
    so the output is JSON-friendly and lookups stay O(1) per word in JS.
    """
    if not isinstance(obj, dict):
        raise CorruptNgramInputError(
            f"{source}: expected dict-like bigram pickle, got {type(obj).__name__}"
        )
    nested: dict[str, dict[str, int]] = {}
    for key, value in obj.items():
        if not (isinstance(key, tuple) and len(key) == 2):
            raise CorruptNgramInputError(
                f"{source}: bigram key {key!r} is not a 2-tuple"
            )
        prev, curr = key
        if not (isinstance(prev, str) and isinstance(curr, str)):
            raise CorruptNgramInputError(
                f"{source}: bigram key contains non-str element: {key!r}"
            )
        if not isinstance(value, int):
            raise CorruptNgramInputError(
                f"{source}: bigram value for {key!r} is {type(value).__name__}, expected int"
            )
        nested.setdefault(prev, {})[curr] = value
    return nested


def _serialize(payload: dict[str, Any]) -> bytes:
    """Serialize the asset payload to compact UTF-8 JSON bytes."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _gzip_size(data: bytes) -> int:
    """Return the gzipped byte length of ``data`` (deterministic, mtime=0)."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(data)
    return len(buf.getvalue())


def convert_ngram(
    ngram_dir: Path,
    output_path: Path,
    *,
    stats: NgramStats | None = None,
) -> NgramStats:
    """Convert the myWord pickled n-grams under ``ngram_dir`` to ``output_path``.

    Raises :class:`MissingNgramInputError` if either pickle is absent.
    Raises :class:`CorruptNgramInputError` if a pickle loads but its
    shape doesn't match the documented contract.
    """
    local = stats if stats is not None else NgramStats()

    unigram_path = ngram_dir / NGRAM_UNIGRAM_FILENAME
    bigram_path = ngram_dir / NGRAM_BIGRAM_FILENAME
    _require_input_file(unigram_path, "unigram")
    _require_input_file(bigram_path, "bigram")

    local.source_unigram = unigram_path
    local.source_bigram = bigram_path
    local.raw_unigram_size = unigram_path.stat().st_size
    local.raw_bigram_size = bigram_path.stat().st_size

    logger.info("loading unigram pickle: %s", unigram_path)
    unigram_raw = _load_pickle(unigram_path)
    unigram = _coerce_unigram(unigram_raw, unigram_path)

    logger.info("loading bigram pickle: %s", bigram_path)
    bigram_raw = _load_pickle(bigram_path)
    bigram = _coerce_bigram(bigram_raw, bigram_path)

    unigram_total = sum(unigram.values())
    bigram_total = sum(sum(inner.values()) for inner in bigram.values())
    bigram_count = sum(len(inner) for inner in bigram.values())

    local.unigram_count = len(unigram)
    local.unigram_total = unigram_total
    local.bigram_count = bigram_count
    local.bigram_total = bigram_total

    payload: dict[str, Any] = {
        "format": NGRAM_FORMAT_TAG,
        "source": {
            "unigram": unigram_path.name,
            "bigram": bigram_path.name,
        },
        "unigram_count": local.unigram_count,
        "unigram_total": unigram_total,
        "bigram_count": bigram_count,
        "bigram_total": bigram_total,
        "unigram": unigram,
        "bigram": bigram,
    }

    serialized = _serialize(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(serialized)
    local.output_size = len(serialized)
    local.output_size_gzipped = _gzip_size(serialized)
    return local


def convert_ngram_to_default(
    ngram_dir: Path,
    output_dir: Path,
    *,
    stats: NgramStats | None = None,
) -> NgramStats:
    """Convenience wrapper that writes to ``<output_dir>/<NGRAM_FILENAME>``."""
    return convert_ngram(ngram_dir, output_dir / NGRAM_FILENAME, stats=stats)
