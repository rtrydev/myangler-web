"""EngMyanDictionary ingestion + Burmese-keyed inversion (spec §6.2 replacement).

The current build pipeline expects ``StrippedEntry`` rows whose ``headword``
is **Burmese** and whose ``glosses`` are short **English** counterparts —
that is the contract every downstream stage (English inverted index,
SQLite, both BK-trees, the frontend) is wired to.

The EngMyanDictionary dataset is the *opposite* shape: each row is an
English headword with a Burmese-rich free-text definition embedded in
HTML. This module performs a **direction inversion**: it parses every
row's Myanmar side into one or more discrete Burmese terms and emits a
``StrippedEntry`` per distinct Burmese term whose gloss list contains the
dataset's English ``word`` (optionally enriched with ``synonym`` values).

Why not reuse :mod:`data_pipeline.steps.strip` directly: ``strip``
consumes kaikki's already-Burmese-keyed JSONL. This step reads a
different schema and inverts it; once inverted, the records flow through
:func:`data_pipeline.steps.index_en.build_index` and every later stage
without modification — they are the same dataclass.

Input contract
--------------
A JSON-lines file (one object per line) carrying *only the text
columns* of the dataset:

  - ``word``           — English headword (string)
  - ``stripword``      — lowercase normalized English word (string)
  - ``title``          — "<word> / <ipa> / <pos>" line (string)
  - ``definition``     — HTML payload with the Burmese translation(s)
  - ``raw_definition`` — plain-text fallback (string; may be lossy)
  - ``keywords``       — comma-separated English related words
  - ``synonym``        — comma-separated English synonyms

The image columns (``image_definition``, ``picture``) MUST NOT be
present; they would balloon the bundle (~950 MB) for no end-user benefit
and we never ship images. The downloader strips them.

Inversion rules — see docs/burmese-dictionary-spec.md §3.1 and the
migration task brief for the rationale.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from data_pipeline.config import ENGLISH_STOPWORDS
from data_pipeline.io import ReadStats, iter_jsonl
from data_pipeline.steps.strip import StrippedEntry, normalize_gloss

logger = logging.getLogger(__name__)


# --- Burmese-script detection ----------------------------------------------

# Mirrors `app/lib/search/scriptDetect.ts::isBurmeseCodepoint` so the
# build-time decision about "what counts as Burmese" matches the runtime
# decision the orchestrator uses for routing.
def _is_burmese_codepoint(cp: int) -> bool:
    if 0x1000 <= cp <= 0x109F:
        return True
    if 0xA9E0 <= cp <= 0xA9FF:  # Myanmar Extended-B
        return True
    if 0xAA60 <= cp <= 0xAA7F:  # Myanmar Extended-A
        return True
    return False


# Latin letter (ASCII only — matches the runtime detector). Used to drop
# example sentences that mix Latin and Burmese.
def _is_latin_letter(cp: int) -> bool:
    return (0x41 <= cp <= 0x5A) or (0x61 <= cp <= 0x7A)


def _contains_burmese(text: str) -> bool:
    return any(_is_burmese_codepoint(ord(ch)) for ch in text)


def _contains_latin_letter(text: str) -> bool:
    return any(_is_latin_letter(ord(ch)) for ch in text)


# --- HTML → plain-text shim -----------------------------------------------

# Tags whose content is structural separation between glosses — when the
# parser sees them, we insert a sentinel separator so the splitter treats
# the two surrounding texts as different glosses. Without this, e.g.
# ``<b>ပထမ</b><b>ဒုတိယ</b>`` would smush into one run.
_BLOCK_TAGS = frozenset(
    {"br", "p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "hr"}
)

# Single character we will not see in normal text; works as a parse-time
# separator between adjacent HTML tags.
_HTML_SEP = "\x01"


class _PlainTextExtractor(HTMLParser):
    """Collect plain text from a `definition` HTML blob.

    Inserts ``_HTML_SEP`` at block-tag boundaries so the post-splitter
    sees adjacent ``<b>…</b><b>…</b>`` Burmese gloss tags as separate
    candidates. Tag attributes are ignored.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCK_TAGS:
            self._parts.append(_HTML_SEP)

    def handle_endtag(self, tag: str) -> None:
        if tag in _BLOCK_TAGS:
            self._parts.append(_HTML_SEP)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCK_TAGS:
            self._parts.append(_HTML_SEP)

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def _html_to_text(html: str) -> str:
    """Reduce an HTML payload to plain text with block separators preserved."""
    if not html:
        return ""
    parser = _PlainTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # pragma: no cover — defensive
        logger.warning("HTML parse failure; falling back to raw text")
        return html
    return parser.text()


# --- POS extraction --------------------------------------------------------

# Coarse POS markers as they appear in the dataset's `title` line. Order
# matters: the longer markers must come first so a `phrv` match is not
# stolen by `v`. Values lower-cased and matched case-insensitively.
_POS_MARKERS: tuple[str, ...] = (
    "phrv",
    "abbr",
    "symb",
    "pref",
    "suff",
    "prep",
    "conj",
    "pron",
    "adv",
    "adj",
    "idm",
    "art",
    "det",
    "num",
    "int",
    "v",
    "n",
)

# `title` looks like "abandon / ǝ'bændǝn / v" or "abacus / 'æbǝkǝs / n".
# Take the trailing token after the last slash and lowercase it.
_TITLE_POS_RE = re.compile(r"/\s*([A-Za-z.]+)\s*$")


def _extract_pos(title: str) -> str:
    if not title:
        return ""
    m = _TITLE_POS_RE.search(title.strip())
    if not m:
        return ""
    raw = m.group(1).strip().rstrip(".").lower()
    if raw in _POS_MARKERS:
        return raw
    # Fall through to longest-prefix match to handle "v.t", "n.pl" etc.
    for marker in _POS_MARKERS:
        if raw.startswith(marker):
            return marker
    return ""


# --- Burmese-term extraction ----------------------------------------------

# Split candidates on Myanmar enumeration / sentence punctuation, the
# dataset's bullet glyphs, and a few ASCII separators that often appear
# in the definition stream. Latin parentheticals are stripped before the
# split happens.
_SPLIT_CHARS: str = "".join(
    [
        "။",      # Burmese sentence terminator (U+104B)
        "၊",      # Burmese comma (U+104A)
        "❏",      # idiom bullet
        "❍",      # example bullet
        "◆",      # other bullets seen in EngMyan content
        "●",
        "◦",
        ";",
        "/",
        "|",
        "\n",
        "\r",
        "\t",
        _HTML_SEP,
    ]
)
_SPLIT_RE = re.compile("[" + re.escape(_SPLIT_CHARS) + "]+")

# Strip Myanmar enumeration prefixes like "၁။ " (Myanmar digit + ။) at
# the head of a candidate, including stray Latin-digit equivalents.
_ENUM_PREFIX_RE = re.compile(r"^[\s၀-၉0-9]+[\.\)။]?\s*")
# And the symmetric case at the tail: when a split on "။" leaves the
# next item's leading enumeration number dangling at the previous
# segment's end (e.g. "ပထမ ၂" after splitting "ပထမ ၂။ ဒုတိယ"), strip it.
_ENUM_SUFFIX_RE = re.compile(r"\s+[၀-၉0-9]+\s*$")

# Drop parenthetical content entirely — including the inner text.
# In EngMyanDictionary the parenthetical bodies are sub-enumeration
# markers ("(က)", "(ခ)") and **sub-categorization lists** of related
# Burmese stems ("(ဝင်၊ ထွက်)" = "(in, out)"). The latter is the main
# source of inversion noise: a row about "allow" that contains
# "(ဝင်၊ ထွက်)ခွင့်ပြုသည်" was, before this drop, emitting ဝင် and ထွက်
# as bare Burmese candidates linked to "allow" — even though "allow"
# does not mean ဝင်. Stripping the bracket *and* its contents fixes
# that for the price of losing the occasional in-parens clarification,
# which is acceptable. Non-greedy so nested-ish content stays bounded.
_PARENS_RE = re.compile(r"\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}")

# Common Burmese dictionary-form suffixes. The segmenter strips these
# as separate particles ("ဝင်သည်" → tokens ["ဝင်", "သည်"], "ကောင်းသော"
# → ["ကောင်း", "သော"]), so user queries land on the **bare stem**.
# EngMyanDictionary's translations always carry the suffix in their
# definition (ဝင်သည် for "enter", ပေးသည် for "give", ကောင်းသော for
# "good"), so without this stripping the actual translation meanings
# never reach the stem headword and the entry detail shows only
# sub-categorization noise. Covers both **verb** suffixes (assertive
# သည်/တယ်) and **adjective** suffixes (သော/တဲ့). Listed longest-first
# so the stripper never eats a partial suffix.
_VERB_SUFFIXES: tuple[str, ...] = (
    "ပါသည်",   # polite assertive (verb)
    "ပါတယ်",   # polite colloquial assertive (verb)
    "သည်",     # assertive (verb), most common
    "တယ်",     # colloquial assertive (verb)
    "သော",     # adjective-forming
    "တဲ့",     # colloquial adjective-forming
)


def _strip_verb_suffix(term: str) -> str:
    """If ``term`` ends in a known verb particle, return the stem.

    Only strips when the stem still contains a Burmese codepoint — we
    never want to reduce a candidate to the empty string or to bare
    punctuation by suffix removal.
    """
    for suffix in _VERB_SUFFIXES:
        if term.endswith(suffix) and len(term) > len(suffix):
            stem = term[: -len(suffix)].rstrip()
            if stem and _contains_burmese(stem):
                return stem
    return term

# Anything that is not Burmese, whitespace, or basic punctuation is
# stripped before we evaluate "does this term still contain Burmese?"
# so the surviving string is the trimmed Burmese run alone.
_NON_BURMESE_TRAILING_RE = re.compile(
    r"^[^က-႟ꩠ-ꩿꧠ-꧿]+|"
    r"[^က-႟ꩠ-ꩿꧠ-꧿]+$"
)

# A candidate is rejected if it has more than this many Latin letters —
# such a run is almost certainly an English example sentence rather than
# a translation. Picked conservatively: a gloss-Burmese line never has
# more than a stray Latin letter or two (an inline abbreviation), while
# example sentences contain dozens.
_MAX_LATIN_LETTERS_IN_BURMESE_TERM: int = 2

# Burmese headwords are short — typically 1–8 syllables (~6–25 codepoints).
# A candidate longer than this is almost always a free-text definition
# sentence rather than a dictionary headword: keeping it would (a) bloat
# the SQLite payload, (b) pollute the Burmese BK-tree with non-headwords,
# and (c) never be useful for forward lookup because users type words,
# not sentences. Real outliers (long compound nouns) still fit comfortably.
_MAX_BURMESE_HEADWORD_CHARS: int = 30

# Per-entry gloss cap. Common Burmese verbs accumulate dozens of
# English primary-translation glosses (ပြော "speak" appears as the
# primary Burmese candidate of say/state/tell/speak/talk/answer/…), so
# even after the primary-only filter (below) some entries would have
# 30+ near-synonym glosses. Cap to a digestible list — the strongest
# are kept by the sort order (primary, then shortest, then frequency).
_MAX_GLOSSES_PER_ENTRY: int = 10

# Index-in-source-row threshold for keeping a gloss. ``min_index`` is
# the smallest position the Burmese term occupied in any English row's
# candidate list. ``0`` means the row treated this Burmese term as its
# **primary translation**; higher values mean our term was a secondary
# candidate. Set to ``1`` so we keep primary translations AND
# first-secondary senses — many real Burmese verb stems (မြင် "see",
# ဆုံ "meet") are emitted at idx=1 because the source row's literal
# primary candidate is a longer descriptive phrase ("ပကတိ မျက်စိဖြင့်
# မြင်ခြင်း" = "seeing with the naked eye") with the bare stem
# appearing second. Filtering to idx==0 alone empties out ~70% of
# entries; idx<=1 preserves coverage while still dropping the
# idiomatic noise (idx>=2) that polluted မိုး (rain) with "the
# heavens" / "freshen up".
_MAX_GLOSS_INDEX: int = 1

# Per-row Burmese candidate cap. Kept generous to preserve coverage —
# the EngMyanDictionary rows include long-tail Burmese candidates that
# still represent real Burmese vocabulary, just at weaker tiers within
# the source row. The reverse-lookup engine applies its own gloss-
# position threshold at query time (``LookupConfig.maxGlossPosition``)
# to filter for relevance, so coverage and lookup precision are now
# controlled at separate layers.
_MAX_CANDIDATES_PER_ROW: int = 20


def _strip_burmese_term(raw: str) -> str:
    """Reduce ``raw`` to a clean Burmese headword candidate, or ``""``.

    The returned string is NFC-normalized and contains at least one
    Burmese codepoint; otherwise the empty string is returned to signal
    "no usable term here".
    """
    if not raw:
        return ""
    # Drop parenthetical groups entirely — see :data:`_PARENS_RE` for
    # why content matters, not just the brackets.
    text = _PARENS_RE.sub(" ", raw)
    # Strip leading and trailing enumeration markers.
    text = _ENUM_PREFIX_RE.sub("", text)
    text = _ENUM_SUFFIX_RE.sub("", text).strip()
    # Trim non-Burmese runs from both ends until what remains starts and
    # ends with Burmese (or is empty).
    while True:
        new = _NON_BURMESE_TRAILING_RE.sub("", text)
        if new == text:
            break
        text = new
    text = text.strip()
    if not text:
        return ""
    # Reject runs that are still mixed-script in their interior — those
    # are example sentences ("English-like quote ဗမာစာ"), not glosses.
    latin_count = sum(1 for ch in text if _is_latin_letter(ord(ch)))
    if latin_count > _MAX_LATIN_LETTERS_IN_BURMESE_TERM:
        return ""
    if not _contains_burmese(text):
        return ""
    # Drop free-text sentences masquerading as headwords. Dictionary
    # entries are short; long Burmese runs are paragraphs that escaped
    # the splitter.
    if len(text) > _MAX_BURMESE_HEADWORD_CHARS:
        return ""
    # Reveal the lexical stem behind any conjugated verb form so the
    # stem (what the segmenter actually emits as a token) carries the
    # translation meaning.
    text = _strip_verb_suffix(text)
    return unicodedata.normalize("NFC", text)


def _split_burmese_candidates(text: str) -> list[str]:
    """Split a Myanmar-side text blob into Burmese-term candidates.

    Returns NFC-normalized, deduped (preserving first-seen order)
    Burmese strings. Non-Burmese segments are dropped.

    Parenthetical content is removed from the whole text *before*
    splitting so that splitters living inside the parens (e.g.
    "(နေ၊ လ)") cannot leak the bracketed stems as standalone
    candidates. Doing the strip on each split piece individually would
    miss those because the comma already broke the pair into two
    unbalanced fragments.
    """
    if not text:
        return []
    # Iteratively peel off bracketed groups so any nesting is handled.
    cleaned = text
    while True:
        new = _PARENS_RE.sub(" ", cleaned)
        if new == cleaned:
            break
        cleaned = new
    pieces = _SPLIT_RE.split(cleaned)
    seen: set[str] = set()
    out: list[str] = []
    for piece in pieces:
        term = _strip_burmese_term(piece)
        if not term or term in seen:
            continue
        seen.add(term)
        out.append(term)
    return out


# --- English counterpart collection ----------------------------------------

# Synonym / keyword columns are comma-separated. Trim, lowercase
# preservation is left to ``normalize_gloss`` later — keep display form
# here so the entry's gloss list reads naturally in the UI.
def _split_csv_field(raw: Any) -> list[str]:
    if not isinstance(raw, str):
        return []
    out: list[str] = []
    for part in raw.split(","):
        cleaned = part.strip()
        if cleaned:
            out.append(cleaned)
    return out


# Word extractor for English-frequency tallying. We count English tokens
# wherever they appear across the dataset (headword `word`, `synonym`,
# `keywords` columns) so a per-token frequency naturally reflects how
# common each English word is in actual English text. The dataset is
# Oxford-style: common words like "work" (~715), "see" (~1,500) recur
# constantly; rare synonyms like "demarcation" (1) almost never do. This
# is the tie-breaker for ranking glosses within a Burmese entry — when
# multiple English glosses tied at the primary-translation slot, the
# more common word wins.
_FREQ_TOKEN_RE = re.compile(r"[a-z][a-z']*[a-z]|[a-z]")


def _tally_english_frequencies(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Count occurrences of every English content word across the dataset.

    Source columns: ``word``, ``synonym``, ``keywords``. Lowercased and
    tokenized; stopwords are not excluded — the frequency map's purpose
    is to compare ranks within the (already-stopword-free) gloss list.
    """
    freq: dict[str, int] = {}
    for raw in rows:
        for field_name in ("word", "synonym", "keywords"):
            v = raw.get(field_name)
            if not isinstance(v, str) or not v:
                continue
            for token in _FREQ_TOKEN_RE.findall(v.lower()):
                freq[token] = freq.get(token, 0) + 1
    return freq


def _gloss_frequency_score(normalized_gloss: str, freq: dict[str, int]) -> int:
    """Score ``gloss`` by the frequency of its **first content word**.

    Glosses are head-initial in English ("go up", "place of duty"); the
    leading content word captures the word's prominence. Stopwords (the,
    of, in, …) are skipped so they don't inflate phrasal glosses that
    contain a common preposition. A gloss that is itself a stopword
    scores 0 (which is unreachable in practice — stopwords don't survive
    ``normalize_gloss`` as standalone glosses).
    """
    if not normalized_gloss:
        return 0
    for token in _FREQ_TOKEN_RE.findall(normalized_gloss):
        if token in ENGLISH_STOPWORDS:
            continue
        return freq.get(token, 0)
    return 0


# --- The inversion step ----------------------------------------------------


@dataclass
class EngmyanStats:
    """Summary of an EngMyanDictionary inversion pass.

    Mirrors :class:`StripStats` in shape so reporting code can treat the
    two interchangeably.
    """

    raw_entries: int = 0  # rows read from the JSONL
    dropped_no_burmese: int = 0  # rows that yielded zero Burmese terms
    burmese_terms_emitted: int = 0  # total terms (sum across rows, pre-merge)
    stripped: int = 0  # final emitted StrippedEntry count (post-merge)
    distinct_headwords: int = 0  # same as stripped — kept for parity
    empty_glosses: int = 0  # entries that ended up with no English glosses
    pos_inferred: int = 0  # entries with a non-empty POS marker
    headwords: set[str] = field(default_factory=set)


def _merge_into_groups(
    rows: Iterable[dict[str, Any]],
    *,
    stats: EngmyanStats,
) -> dict[str, dict[str, Any]]:
    """First pass: walk the rows, accumulate Burmese-headword → state.

    The returned mapping is in **first-seen order** (Python ``dict``
    preserves insertion order) which the second pass converts into a
    sequence of ``StrippedEntry`` instances with stable ``entry_id``s.
    """
    groups: dict[str, dict[str, Any]] = {}
    for raw in rows:
        stats.raw_entries += 1

        eng_word = raw.get("word")
        if not isinstance(eng_word, str) or not eng_word.strip():
            stats.dropped_no_burmese += 1
            continue
        eng_word = eng_word.strip()

        title = raw.get("title") if isinstance(raw.get("title"), str) else ""
        pos = _extract_pos(title or "")

        definition = raw.get("definition") if isinstance(raw.get("definition"), str) else ""
        raw_def = (
            raw.get("raw_definition")
            if isinstance(raw.get("raw_definition"), str)
            else ""
        )
        # Prefer the structured HTML; fall back to plain text only when
        # the HTML payload is missing (dataset README warns the plain
        # variant is lossy).
        body_text = _html_to_text(definition) if definition else (raw_def or "")
        burmese_terms = _split_burmese_candidates(body_text)
        if not burmese_terms:
            stats.dropped_no_burmese += 1
            continue
        # Drop the long tail — early candidates are the row's actual
        # translations; later ones tend to be Burmese fragments from
        # example sentences that would only bloat reverse-lookup
        # buckets.
        if len(burmese_terms) > _MAX_CANDIDATES_PER_ROW:
            burmese_terms = burmese_terms[:_MAX_CANDIDATES_PER_ROW]
        stats.burmese_terms_emitted += len(burmese_terms)

        # `synonym` is a curated English synonym list — keep it. The
        # dataset's `keywords` column, despite the name, is a bag of
        # **English example-sentence content words** ("answer,biography,
        # hamlet,his,our,seen,surely,the,time,verdict,will"). Those are
        # not translations and would pollute both the gloss display and
        # the English inverted index. Drop entirely.
        synonyms = _split_csv_field(raw.get("synonym"))
        # ``(display_form, is_synonym)`` pairs. The English row's own
        # ``word`` column is the **headword** — the canonical English
        # term that names this entry. Its synonyms are alternative
        # wordings that may or may not be tight translations. Tracking
        # the distinction lets the finalize step prefer the headword
        # when ranking glosses, so a row like "temper" (with synonyms
        # "anger, rage, …") surfaces "temper" rather than the more
        # frequent but less direct "anger" on a Burmese inversion.
        english_candidates: list[tuple[str, bool]] = [
            (eng_word, False),
            *((s, True) for s in synonyms),
        ]

        # Iterate with each Burmese candidate's *position* within this
        # English row. A term at position 0 is the row's PRIMARY
        # translation; later positions are alternative / weaker links.
        # We use this to rank glosses on the receiving Burmese-headword
        # side so the displayed first gloss is meaningful, not just
        # alphabetically-first.
        for term_index, term in enumerate(burmese_terms):
            group = groups.get(term)
            if group is None:
                group = {
                    # normalized gloss → [best_index_seen, display_form, is_synonym]
                    "glosses_seen": {},
                    "pos_votes": {},
                }
                groups[term] = group
            glosses_seen: dict[str, list] = group["glosses_seen"]
            for gloss, is_synonym in english_candidates:
                key = normalize_gloss(gloss)
                if not key:
                    continue
                existing = glosses_seen.get(key)
                if existing is None:
                    glosses_seen[key] = [term_index, gloss, is_synonym]
                else:
                    # Promote on a stronger signal. We prefer (a) a
                    # smaller min_index, then (b) headword over synonym
                    # at the same min_index — the row that contributed
                    # this gloss as ITS headword is more authoritative
                    # than the row that contributed it as a synonym.
                    cur_idx, _, cur_syn = existing
                    new_better = (term_index, is_synonym) < (cur_idx, cur_syn)
                    if new_better:
                        glosses_seen[key] = [term_index, gloss, is_synonym]
            if pos:
                group["pos_votes"][pos] = group["pos_votes"].get(pos, 0) + 1
    return groups


def _finalize_groups(
    groups: dict[str, dict[str, Any]],
    *,
    english_freq: dict[str, int],
    stats: EngmyanStats,
) -> Iterator[StrippedEntry]:
    """Second pass: turn the accumulated groups into StrippedEntry rows."""
    next_id = 0
    for headword, group in groups.items():
        glosses_seen: dict[str, list] = group["glosses_seen"]
        pos_votes: dict[str, int] = group["pos_votes"]

        # Filter to primary-translation-only glosses. A gloss with
        # ``min_index == 0`` means the English row treated our Burmese
        # headword as ITS primary Burmese candidate — the strongest
        # possible signal that this English word is a meaning of the
        # Burmese term. Glosses with ``min_index > 0`` came from English
        # rows where our Burmese term was a sub-candidate, which is
        # where most of the cross-sense noise lives. See the data audit
        # in the migration notes for the per-entry impact.
        primary_glosses = {
            k: v for k, v in glosses_seen.items() if v[0] <= _MAX_GLOSS_INDEX
        }
        # Rank glosses by four signals (in this priority):
        #   1. **primary-ness** (ASC): smaller best-seen-index means
        #      this English word listed our Burmese headword as a
        #      primary translation rather than an incidental mention.
        #   2. **headword over synonym** (False over True): the gloss
        #      that came from an English row's ``word`` column wins
        #      over the same normalized gloss contributed only as a
        #      synonym. Fixes cases like ဖေးမ (showed "anger" — a
        #      synonym of the "temper" row — when "temper" the
        #      headword is the direct mapping) and သင်ပေး (showed
        #      "school" — a synonym — instead of "teach" / "instruct"
        #      which are the headwords whose primary Burmese candidate
        #      is သင်ပေး).
        #   3. **gloss length in words** (ASC): single-word glosses
        #      always beat phrasal equivalents at the same primary
        #      tier. Without this, phrasal verbs starting with very
        #      common heads ("take a seat", "put pen to paper") would
        #      out-rank their simpler synonyms ("sit", "write") just
        #      because "take"/"put" are themselves frequent.
        #   4. **English-corpus frequency** (DESC): among glosses of the
        #      same length, the more common English word wins. "work"
        #      beats "demarcation"; "give" beats "endow".
        ranked = sorted(
            primary_glosses.items(),
            key=lambda kv: (
                kv[1][0],
                kv[1][2],  # is_synonym: False (0) before True (1)
                len(kv[0].split()),
                -_gloss_frequency_score(kv[0], english_freq),
            ),
        )
        # Apply the per-entry cap AFTER ranking so the strongest glosses
        # survive even when a Burmese term has dozens of primary-tier
        # English sources (verbs like ပြော "say/tell/speak/...").
        ranked = ranked[:_MAX_GLOSSES_PER_ENTRY]
        normalized_glosses = tuple(key for key, _ in ranked)
        display_glosses = tuple(value[1] for _, value in ranked)

        if not display_glosses:
            # After the primary-gloss filter, an entry with no remaining
            # glosses is a Burmese term that was *only ever* a deep
            # sub-candidate in source rows — typically a definition
            # fragment, not a real lexical headword. Skip it: it cannot
            # contribute meaning to forward lookup and bloats the BK-tree
            # and the bundle.
            stats.empty_glosses += 1
            continue

        # Pick the POS marker with the strongest support; ties break on
        # the marker order in _POS_MARKERS for determinism.
        pos = ""
        if pos_votes:
            best = max(pos_votes.values())
            tied = [p for p, c in pos_votes.items() if c == best]
            if len(tied) == 1:
                pos = tied[0]
            else:
                # Stable tiebreak: earliest in _POS_MARKERS wins.
                order = {marker: i for i, marker in enumerate(_POS_MARKERS)}
                pos = sorted(tied, key=lambda p: order.get(p, len(_POS_MARKERS)))[0]
            stats.pos_inferred += 1

        entry = StrippedEntry(
            entry_id=next_id,
            headword=headword,
            pos=pos,
            glosses=display_glosses,
            normalized_glosses=normalized_glosses,
            ipa=None,  # English IPA under a Burmese headword would mislead.
        )
        next_id += 1
        stats.stripped += 1
        stats.headwords.add(headword)
        yield entry
    stats.distinct_headwords = len(stats.headwords)


def invert_engmyan(
    raw_rows: Iterable[dict[str, Any]],
    *,
    stats: EngmyanStats | None = None,
) -> Iterator[StrippedEntry]:
    """Invert EngMyanDictionary rows into Burmese-keyed ``StrippedEntry``s.

    Streams the input twice in spirit (group → finalize) but only once
    in memory: the first pass consumes the iterable; the second pass
    walks the in-memory groups dict. A ``StripStats``-shaped
    :class:`EngmyanStats` instance is filled in along the way.
    """
    local = stats if stats is not None else EngmyanStats()
    # Materialize once: we need the rows twice (frequency tally +
    # primary-gloss merge). The dataset is tens of MB so this is cheap.
    rows_list = list(raw_rows)
    english_freq = _tally_english_frequencies(rows_list)
    groups = _merge_into_groups(rows_list, stats=local)
    yield from _finalize_groups(groups, english_freq=english_freq, stats=local)


def invert_engmyan_file(
    path: Path,
) -> tuple[list[StrippedEntry], EngmyanStats, ReadStats]:
    """Stream ``path`` and return the full list of inverted entries.

    Used by the CLI when the ``engmyan`` subcommand runs standalone.
    """
    read_stats = ReadStats()
    invert_stats = EngmyanStats()
    entries = list(
        invert_engmyan(iter_jsonl(path, stats=read_stats), stats=invert_stats)
    )
    return entries, invert_stats, read_stats


class MissingEngmyanInputError(FileNotFoundError):
    """Raised when the expected EngMyanDictionary JSONL is not on disk.

    The CLI converts this to a clean, actionable error message (mirrors
    ``convert-ngram`` behavior — no stack trace at the user).
    """
