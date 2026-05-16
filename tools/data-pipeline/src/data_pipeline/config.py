"""Centralized configuration for the data pipeline.

Paths resolve against the repository root so the tool behaves identically
no matter what directory the CLI is invoked from. Constants the pipeline
steps depend on — asset filenames, the English stopword list, fuzzy
thresholds, version-stamp scheme — all live here.
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

# Primary dictionary input — the EngMyanDictionary HuggingFace dataset
# (spec §3.1). Produced by ``tools/data-pipeline/scripts/download_engmyan.py``,
# which strips the dataset's image columns and lands only the text columns
# as JSONL at this path. Git-ignored.
DEFAULT_INPUT_PATH: Path = REPO_ROOT / "data" / "engmyan" / "engmyan.jsonl"

# Legacy kaikki Burmese extract. The ``strip`` subcommand still reads
# it for back-compat / regression testing, but it is no longer in the
# default ``all`` pipeline.
LEGACY_KAIKKI_INPUT_PATH: Path = REPO_ROOT / "data" / "dictionary-burmese.jsonl"

# Optional myG2P headword list for coverage extension (spec §3.2). Path is a
# placeholder; the `merge-g2p` step remains a stub in this task.
DEFAULT_MYG2P_PATH: Path = REPO_ROOT / "data" / "myg2p-headwords.txt"

# Pickled myWord n-gram dictionaries (spec §4.2). The user is expected to
# place (or symlink) the merged myWord ``dict_ver1/`` files here. Only the
# *word* unigram + bigram pickles are consumed: the spec's JS Viterbi port
# is the *word* segmenter (§2.2 / §4.2); the phrase n-grams ship with myWord
# but the app exposes no phrase-segmentation feature, so they are not
# converted here. README.md documents how to obtain and place the inputs.
DEFAULT_NGRAM_DIR: Path = REPO_ROOT / "data" / "myword"
NGRAM_UNIGRAM_FILENAME: str = "unigram-word.bin"
NGRAM_BIGRAM_FILENAME: str = "bigram-word.bin"

# --- Outputs ----------------------------------------------------------------

# Built artifacts land here. Git-ignored. Created on demand by io.ensure_output_dir.
DEFAULT_OUTPUT_DIR: Path = TOOL_ROOT / "build"

# Filenames the build pipeline produces under ``DEFAULT_OUTPUT_DIR``. The
# frontend / service worker consume these names directly.
DB_FILENAME: str = "dictionary.sqlite"
BKTREE_EN_FILENAME: str = "bktree-en.json"
BKTREE_MY_FILENAME: str = "bktree-my.json"
NGRAM_FILENAME: str = "ngram.json"
VERSION_FILENAME: str = "version.json"

# --- Reverse-lookup index (spec §3.4) ---------------------------------------

# Stopwords excluded from the English inverted index. The list focuses on
# closed-class English words that appear so often in Wiktionary glosses that
# indexing them would surface a huge fraction of entries on any common query:
# articles, common prepositions, conjunctions, copulas, basic pronouns, the
# "to" infinitive marker. Picked conservatively — anything semantically loaded
# (color words, common nouns, adjectives) is intentionally NOT here so the
# user can still search for it.
ENGLISH_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the",
        "of", "to", "in", "on", "at", "by", "for", "from", "with", "as",
        "into", "onto", "out", "off", "over", "under", "up", "down",
        "and", "or", "but", "nor", "so", "yet", "if", "than", "that",
        "this", "these", "those",
        "is", "are", "was", "were", "be", "been", "being", "am",
        "do", "does", "did", "done",
        "have", "has", "had",
        "it", "its", "he", "him", "his", "she", "her", "hers",
        "they", "them", "their", "theirs",
        "we", "us", "our", "ours", "you", "your", "yours", "i", "me", "my", "mine",
        "not", "no",
        "s",  # leftover from possessive splits
    }
)

# Location for an override stopword file if a later task wants to ship one
# as data rather than code. Optional; not required to exist.
STOPWORDS_FILE: Path = TOOL_ROOT / "data" / "stopwords-en.txt"

# --- Fuzzy thresholds (spec §2.5) -------------------------------------------

# Per the spec, the fuzzy threshold is an adjustable configuration constant
# and may be tuned independently per direction. Defaults match spec §2.5.
FUZZY_THRESHOLD_EN: int = 1  # character-level edit distance over gloss-words
FUZZY_THRESHOLD_MY: int = 1  # syllable-level edit distance over headwords

# --- Version stamp (spec §3.3 / §5.2) ---------------------------------------

# Scheme: integer Unix timestamp in seconds (UTC). Sortable, opaque to
# every consumer (the runtime compares for equality, the deploy bakes it
# into the fingerprinted SQLite filename), and trivially short — picking
# seconds rather than millis keeps the URL component compact. Documented
# in tools/data-pipeline/README.md.
VERSION_SCHEME: str = "unix-timestamp/v1"

# --- N-gram payload (spec §4.2.3) -------------------------------------------

# Total precached payload should stay manageable. Real budget is to be
# benchmarked (spec §8); placeholder is the working ceiling from §4.2.
TARGET_PAYLOAD_MAX_MB: int = 50

# --- Bundle safety net ------------------------------------------------------

# Hard ceiling on ``dictionary.sqlite``. The EngMyanDictionary dataset
# carries image columns (PNG renders + illustrative pictures) totaling
# ~950 MB; the download script and the inversion step both refuse to
# touch them, but if a future change reintroduces them the shipped DB
# would explode well past this limit and the build fails loudly. Set
# well above the text-only inverted size (~40 MB at the current dataset
# rev) so legitimate coverage growth doesn't trip the guard, but far
# below the "images leaked" range (hundreds of MB).
MAX_DB_SIZE_BYTES: int = 80 * 1024 * 1024  # 80 MiB


@dataclass(frozen=True)
class PipelineConfig:
    """Runtime configuration assembled by the CLI from defaults + flags."""

    input_path: Path = DEFAULT_INPUT_PATH
    output_dir: Path = DEFAULT_OUTPUT_DIR
    myg2p_path: Path = DEFAULT_MYG2P_PATH
    ngram_dir: Path = DEFAULT_NGRAM_DIR
    # Optional secondary dictionary: when present, the legacy kaikki
    # Burmese-keyed JSONL is layered onto the EngMyan-derived entries
    # (kaikki takes precedence — see ``steps/merge.py``). Set to a
    # non-existent path to disable the overlay (e.g., for tests that
    # exercise the engmyan-only path in isolation).
    kaikki_input_path: Path = LEGACY_KAIKKI_INPUT_PATH
    fuzzy_threshold_en: int = FUZZY_THRESHOLD_EN
    fuzzy_threshold_my: int = FUZZY_THRESHOLD_MY
    stopwords: frozenset[str] = field(default_factory=lambda: ENGLISH_STOPWORDS)
