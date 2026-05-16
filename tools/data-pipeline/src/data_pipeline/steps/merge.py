"""Hybrid merge of kaikki-derived + EngMyanDictionary-derived entries.

The two source dictionaries have complementary strengths:

- **kaikki / Wiktionary (legacy)**: Burmese-keyed. Modest coverage (~8k
  headwords) but **excellent multi-POS detail**, including dedicated
  particle entries with descriptive linguistic glosses
  (``တယ်`` → "marks a realis verb in the present or past tense";
  ``ပါ`` particle → "please, particle used to indicate politeness,
  particle denoting inclusion"). The strip step keeps each kaikki row
  as its own ``StrippedEntry`` so a polysemous Burmese word retains
  separate verb / particle / noun senses.
- **EngMyanDictionary (primary)**: English-keyed; after inversion gives
  wide lexical coverage of contemporary Burmese vocabulary but **no
  entries at all for pure grammar particles** (the source has no
  English headword for ``တယ်``, ``တဲ့``, ``ခဲ့``, …).

This merge prefers **kaikki for any headword it covers** — its
hand-crafted particle entries are the reason the legacy build felt
right grammatically. EngMyan entries fill in only the gap: headwords
kaikki does not have.

Entry IDs are reassigned sequentially after the merge so the SQLite
primary-key contract is preserved.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from data_pipeline.steps.strip import StrippedEntry


# POS-priority for ordering multiple kaikki entries that share a
# headword. Lower values come first. The general principle:
#
# - **Function-word POSes** (classifier, postp, conj, num, det,
#   particle) usually carry the sense the segmenter is most likely to
#   intend for a short Burmese token. Many words that look like nouns
#   in kaikki's row order (``ပါ`` noun "domino", ``မယ်`` noun "woman",
#   ``ပဲ`` noun "bean", ``ကို`` noun "form of address") are far more
#   commonly used as particles in modern Burmese text.
# - **Suffix-style particles** (whose glosses explicitly describe a
#   particle that's *suffixed to* or *follows* another word —
#   ``နေ`` "suffixed to a verb to denote a continuing process",
#   ``ကောင်း`` "particle following a verb…") are a special case:
#   they're never the standalone meaning a user sees in the segmenter
#   preview, so they are demoted below the lexical (verb/adj) entries.
# - **Character / name / symbol** entries (``စ`` "Ca, the 6th letter",
#   ``အ`` "A, the 33rd and last letter") are almost never what the user
#   means when typing a Burmese token in a sentence — push to the
#   bottom.
_POS_PRIORITY: dict[str, int] = {
    "postp": 1,
    "conj": 2,
    "num": 3,
    "det": 4,
    "particle": 5,
    # ``suffix`` sits alongside ``particle`` because kaikki uses it for
    # genuinely common grammatical morphemes that look like particles
    # in modern use — ``တွေ`` "used to form regular plurals" being the
    # canonical example. ``သာ`` is the counterexample (suffix gloss
    # "particle suffixed to a verb to denote feasibility"); the
    # suffix-particle-marker check below catches that case and demotes
    # the entry, the same way it does for verb-attached particles.
    "suffix": 6,
    "adv": 7,
    "classifier": 8,
    "verb": 9,
    "adj": 10,
    "noun": 11,
    "pron": 12,
    "prefix": 13,
    "intj": 14,
    "name": 15,
    "character": 16,
    "symbol": 17,
}

# Suffix-particle gloss markers. When the first gloss of a ``particle``
# entry describes a particle that's *attached to* another word class
# (and so is meaningless on its own — the entry only fires as a suffix
# in real text), the entry is demoted so the standalone lexical sense
# leads. ``တဲ့`` "suffixed to a word/phrase/sentence" entries are still
# legitimate primary particles, so the markers are deliberately narrow
# to ``verb`` / ``noun`` attachments.
_SUFFIX_PARTICLE_MARKERS: tuple[str, ...] = (
    "suffixed to a verb",
    "suffixed to verbs",
    "suffixed to a noun",
    "suffixed to nouns",
    "particle following a verb",
    "follows a verb",
    "combined with verb",
    "combined with verbs",
    "affixed to a verb",
)

# Markers that identify a *general* numeral classifier (one that
# routinely co-occurs with numbers in real Burmese sentences). Without
# this gate, the ``classifier`` POS bracket would also promote rare
# "measure word" senses like ``လုပ်`` "mouthful (of food)" above the
# everyday verb sense "to do".
_GENERAL_CLASSIFIER_MARKERS: tuple[str, ...] = (
    "classifier for",
    "numeral classifier",
)


def _entry_sort_key(entry: StrippedEntry) -> tuple[int, int]:
    """POS-priority + (particle-only) length tiebreak for kaikki entries.

    Returns ``(pos_priority, first_gloss_length)``. The length tiebreak
    fires **only for particle entries**: kaikki occasionally lists a
    very specific archaic particle first (``မယ်`` "title used by young
    women in lieu of မ (ma.), typically in literature") ahead of the
    everyday one (``မယ်`` "used to indicate the future tense"), and the
    shorter wording is almost always the more general / common one.
    For verbs / nouns / etc. the length signal is unreliable
    (``စ`` verb "to tease, taunt" is shorter than "to begin, start,
    commence" but begin is the primary sense) — fall back to a stable
    sort over kaikki's original row order for those.
    """
    pos = entry.pos
    priority = _POS_PRIORITY.get(pos, 50)
    first_len = 0
    if pos in ("particle", "suffix") and entry.glosses:
        first_gloss = entry.glosses[0].lower()
        if any(marker in first_gloss for marker in _SUFFIX_PARTICLE_MARKERS):
            # Suffix attached to a verb (``သာ`` "particle suffixed to a
            # verb to denote feasibility") is meaningless standalone —
            # the lexical sense should lead.
            priority = _POS_PRIORITY["intj"]
        # Length tiebreak only for particles (see docstring); suffix
        # entries don't benefit from it because kaikki rarely lists
        # multiple suffix glosses for the same headword.
        if pos == "particle":
            first_len = len(entry.glosses[0])
    elif pos == "classifier" and entry.glosses:
        first_gloss = entry.glosses[0].lower()
        if not any(marker in first_gloss for marker in _GENERAL_CLASSIFIER_MARKERS):
            # Rare/specific measure word — demote to noun-level so the
            # standalone verb sense (when there is one) leads.
            priority = _POS_PRIORITY["noun"]
    return (priority, first_len)


@dataclass
class MergeStats:
    """Summary of a hybrid merge pass.

    All counts are post-merge — they reflect the *contribution* of each
    source to the final entry list, not the input lengths (kaikki has
    multiple rows per headword, so its input is larger than its
    contributed-entries count).
    """

    kaikki_kept: int = 0       # kaikki entries that made it into output
    engmyan_kept: int = 0      # engmyan entries kept (their headword was not in kaikki)
    engmyan_dropped: int = 0   # engmyan entries dropped (kaikki already covered the headword)
    distinct_headwords: int = 0


def merge_dictionaries(
    kaikki_entries: list[StrippedEntry],
    engmyan_entries: list[StrippedEntry],
    *,
    stats: MergeStats | None = None,
) -> list[StrippedEntry]:
    """Combine kaikki + engmyan entries with kaikki preferred on conflicts.

    The output preserves kaikki's multi-entry-per-headword shape: if a
    Burmese word has separate verb / particle / noun rows in kaikki, all
    of them ride through unchanged. Each engmyan entry is kept only when
    its (NFC-normalized) headword is *not* present in kaikki.
    """
    local = stats if stats is not None else MergeStats()

    out: list[StrippedEntry] = []
    headwords_seen: set[str] = set()

    # Pass 1: keep every kaikki entry. NFC-normalize the headword for
    # consistent comparison with engmyan (which already NFC-normalizes).
    # Group entries by NFC'd headword first so we can apply the
    # POS-priority sort *within* a headword's entries — kaikki's
    # original row order often places a less-relevant POS first
    # (``ပါ`` verb before particle; ``တစ်`` verb before num; ``ယောက်``
    # verb before classifier), and the breakdown preview only shows
    # the first entry's first gloss.
    by_hw: dict[str, list[StrippedEntry]] = {}
    hw_order: list[str] = []
    for e in kaikki_entries:
        hw_nfc = unicodedata.normalize("NFC", e.headword)
        if hw_nfc not in by_hw:
            by_hw[hw_nfc] = []
            hw_order.append(hw_nfc)
        by_hw[hw_nfc].append(
            StrippedEntry(
                entry_id=-1,  # rewritten below
                headword=hw_nfc,
                pos=e.pos,
                glosses=e.glosses,
                normalized_glosses=e.normalized_glosses,
                ipa=e.ipa,
            )
        )

    for hw_nfc in hw_order:
        group = by_hw[hw_nfc]
        # Stable sort by POS priority then shorter first-gloss.
        # Identical-key entries keep their relative kaikki order so the
        # diff vs the legacy build is minimal for unambiguous lexical
        # headwords.
        group.sort(key=_entry_sort_key)
        out.extend(group)
        headwords_seen.add(hw_nfc)
        local.kaikki_kept += len(group)

    # Pass 2: add engmyan entries whose headword is not yet present.
    for e in engmyan_entries:
        if e.headword in headwords_seen:
            local.engmyan_dropped += 1
            continue
        out.append(
            StrippedEntry(
                entry_id=-1,  # rewritten below
                headword=e.headword,
                pos=e.pos,
                glosses=e.glosses,
                normalized_glosses=e.normalized_glosses,
                ipa=e.ipa,
            )
        )
        headwords_seen.add(e.headword)
        local.engmyan_kept += 1

    # Reassign entry IDs sequentially so the SQLite primary key stays
    # in a contiguous 0..N-1 range.
    renumbered: list[StrippedEntry] = [
        StrippedEntry(
            entry_id=i,
            headword=e.headword,
            pos=e.pos,
            glosses=e.glosses,
            normalized_glosses=e.normalized_glosses,
            ipa=e.ipa,
        )
        for i, e in enumerate(out)
    ]
    local.distinct_headwords = len(headwords_seen)
    return renumbered
