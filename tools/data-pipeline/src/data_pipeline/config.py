"""Centralized configuration for the data pipeline.

Paths resolve against the repository root so the tool behaves identically
no matter what directory the CLI is invoked from. Constants that later
pipeline steps will need are declared here as placeholders with pointers
back into ``docs/burmese-dictionary-spec.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


def _find_repo_root(start: Path) -> Path:
    """Walk upward from ``start`` until a ``.git`` directory is found.

    Falls back to ``tools/data-pipeline``'s parent-of-parent if no ``.git``
    is present (e.g. someone unpacked the tool into an unrelated tree).
    """
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    # Tool lives at <repo>/tools/data-pipeline/src/data_pipeline/config.py.
    # parents[3] -> tools/data-pipeline, parents[4] -> repo root.
    return start.parents[4] if len(start.parents) >= 5 else start


REPO_ROOT: Path = _find_repo_root(Path(__file__).resolve())
TOOL_ROOT: Path = REPO_ROOT / "tools" / "data-pipeline"

# --- Inputs -----------------------------------------------------------------

# Raw kaikki.org Burmese extract (spec §3.1). Already downloaded by the user.
DEFAULT_INPUT_PATH: Path = REPO_ROOT / "data" / "dictionary-burmese.jsonl"

# Optional myG2P headword list for coverage extension (spec §3.2). Path is a
# placeholder; later tasks will wire merging in.
DEFAULT_MYG2P_PATH: Path = REPO_ROOT / "data" / "myg2p-headwords.txt"

# Pickled myWord n-gram dictionaries (spec §4.2). Placeholder directory;
# population is owned by the n-gram conversion step.
DEFAULT_NGRAM_DIR: Path = REPO_ROOT / "data" / "myword"

# --- Outputs ----------------------------------------------------------------

# Built artifacts land here. Git-ignored. Created on demand by io.ensure_output_dir.
DEFAULT_OUTPUT_DIR: Path = TOOL_ROOT / "build"

# --- Reverse-lookup index (spec §3.4) ---------------------------------------

# Stopwords excluded from the English inverted index. Final list is owned by
# the index-build step; this placeholder mirrors the examples given in the
# spec so future code has an obvious anchor to extend.
ENGLISH_STOPWORDS: frozenset[str] = frozenset({"a", "an", "the", "of", "to", "and", "or"})

# Location for an override stopword file, if a later task wants to ship one
# as data rather than code. Optional; not required to exist.
STOPWORDS_FILE: Path = TOOL_ROOT / "data" / "stopwords-en.txt"

# --- Fuzzy thresholds (spec §2.5) -------------------------------------------

# Per the spec, the fuzzy threshold is an adjustable configuration constant
# and may be tuned independently per direction. Defaults match spec §2.5.
FUZZY_THRESHOLD_EN: int = 1  # character-level edit distance over gloss-words
FUZZY_THRESHOLD_MY: int = 1  # syllable-level edit distance over headwords

# --- Version stamp (spec §5.2) ----------------------------------------------

# The shipped data assets embed a version string the service worker uses to
# invalidate caches. Real value is emitted by the `version` step. Format is
# a placeholder: "YYYYMMDD-<short-hash>" is the current working convention.
VERSION_STAMP_FORMAT: str = "{date}-{short_hash}"

# --- N-gram payload (spec §4.2.3) -------------------------------------------

# Total precached payload should stay manageable. Real budget is to be
# benchmarked (spec §8); placeholder is the working ceiling from §4.2.
TARGET_PAYLOAD_MAX_MB: int = 50


@dataclass(frozen=True)
class PipelineConfig:
    """Runtime configuration assembled by the CLI from defaults + flags."""

    input_path: Path = DEFAULT_INPUT_PATH
    output_dir: Path = DEFAULT_OUTPUT_DIR
    myg2p_path: Path = DEFAULT_MYG2P_PATH
    ngram_dir: Path = DEFAULT_NGRAM_DIR
    fuzzy_threshold_en: int = FUZZY_THRESHOLD_EN
    fuzzy_threshold_my: int = FUZZY_THRESHOLD_MY
    stopwords: frozenset[str] = field(default_factory=lambda: ENGLISH_STOPWORDS)
