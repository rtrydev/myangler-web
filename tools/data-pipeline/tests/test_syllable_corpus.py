"""Cross-language parity test for the Burmese syllable segmenter.

The shared corpus lives in ``app/lib/segmenter/__fixtures__/syllable-corpus.json``
and is the single source of truth that both the Python ``segment_syllables``
and the TypeScript port must match. Diverging from it on either side is a
correctness regression (see Task 04, Requirement 2).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_pipeline.syllable import segment_syllables

REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS_PATH = REPO_ROOT / "app" / "lib" / "segmenter" / "__fixtures__" / "syllable-corpus.json"


def _load_cases() -> list[tuple[str, str, list[str]]]:
    payload = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    assert payload["format"] == "syllable-corpus/v1", payload.get("format")
    return [(c["name"], c["input"], c["expected"]) for c in payload["cases"]]


@pytest.mark.parametrize("name, text, expected", _load_cases())
def test_shared_corpus_parity(name: str, text: str, expected: list[str]) -> None:
    assert segment_syllables(text) == expected, name
