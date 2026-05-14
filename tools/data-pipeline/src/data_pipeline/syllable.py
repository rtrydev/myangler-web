"""Burmese syllable segmentation utility (spec §4.1).

A small, self-contained regex segmenter — the build-time analogue of the
`sylbreak` approach — used by the Burmese BK-tree to tokenize headwords
into syllables before computing edit distance over the syllable sequence
(spec §2.5).

This is **not** the JS port shipped to the frontend, and it is **not** the
myWord word segmenter. It is a small build-time helper.

Algorithm (mirrors the canonical `sylbreak` rule)
-------------------------------------------------
A syllable boundary sits **before** a Burmese consonant unless that
consonant is either:

  - **stacked** under the previous consonant (preceded by U+1039 VIRAMA), or
  - **closing** the previous syllable (immediately followed by U+103A ASAT).

Everything else (medials, vowel signs, tone marks, anusvara, dot-below,
visarga, virama itself) is attached to the syllable currently being built.

Non-Burmese codepoints — spaces, ASCII, punctuation — are each emitted as
their own one-character "syllable". This keeps the segmenter total (it
never refuses input) without making mixed-script text collapse into a
single huge cluster the BK-tree would mishandle.
"""

from __future__ import annotations

# Burmese Unicode block (U+1000–U+109F).
ASAT = "်"    # ်
VIRAMA = "္"  # ္


def _is_consonant(ch: str) -> bool:
    """True if ``ch`` is a Burmese consonant (U+1000..U+1021)."""
    return "က" <= ch <= "အ"


def _is_burmese_attached(ch: str) -> bool:
    """True if ``ch`` is a codepoint that attaches to the current syllable.

    Covers: dependent vowel signs (U+102B..U+1035), various marks
    (U+1036..U+1038 anusvara/dot-below/visarga), asat (U+103A), virama
    (U+1039 — its own break-suppressor), medials (U+103B..U+103E), and
    the Pali/Mon extension dependents (U+1056..U+1059, U+105E..U+1060,
    U+1062..U+1064, U+1067..U+106D, U+1071..U+1074, U+1082..U+108D,
    U+108F, U+109A..U+109D).
    """
    cp = ord(ch)
    return (
        0x102B <= cp <= 0x103E
        or 0x1056 <= cp <= 0x1059
        or 0x105E <= cp <= 0x1060
        or 0x1062 <= cp <= 0x1064
        or 0x1067 <= cp <= 0x106D
        or 0x1071 <= cp <= 0x1074
        or 0x1082 <= cp <= 0x108D
        or cp == 0x108F
        or 0x109A <= cp <= 0x109D
    )


def _is_burmese_initial(ch: str) -> bool:
    """A codepoint that may start a new syllable on its own.

    Burmese consonants, independent vowels (U+1023..U+102A), digits
    (U+1040..U+1049), and a handful of standalone signs / Pali letters
    (U+104A..U+104F, U+1050..U+1055, U+105A..U+105D, U+1061, U+1065..U+1066,
    U+106E..U+1070, U+1075..U+1081, U+108E, U+1090..U+1099, U+109E..U+109F).
    """
    cp = ord(ch)
    if 0x1000 <= cp <= 0x1021:
        return True
    if 0x1023 <= cp <= 0x102A:
        return True
    if 0x1040 <= cp <= 0x104F:
        return True
    if 0x1050 <= cp <= 0x1055:
        return True
    if 0x105A <= cp <= 0x105D:
        return True
    if cp == 0x1061 or 0x1065 <= cp <= 0x1066:
        return True
    if 0x106E <= cp <= 0x1070:
        return True
    if 0x1075 <= cp <= 0x1081:
        return True
    if cp == 0x108E:
        return True
    if 0x1090 <= cp <= 0x1099:
        return True
    if 0x109E <= cp <= 0x109F:
        return True
    return False


def segment_syllables(text: str) -> list[str]:
    """Segment a Burmese string into syllable clusters.

    See the module docstring for the rule. Returns ``[]`` for empty input.
    """
    if not text:
        return []

    # First pass: compute break positions (start indices of each syllable).
    breaks: list[int] = [0]
    n = len(text)
    for i in range(1, n):
        ch = text[i]
        if _is_consonant(ch):
            # Stacking: virama immediately before this consonant attaches it
            # to the previous syllable.
            if i >= 1 and text[i - 1] == VIRAMA:
                continue
            # Final-consonant closer: consonant + asat closes the previous
            # syllable, so do not break before it.
            if i + 1 < n and text[i + 1] == ASAT:
                continue
            breaks.append(i)
        elif _is_burmese_initial(ch):
            # Independent vowels, digits, standalone signs start a syllable.
            breaks.append(i)
        elif _is_burmese_attached(ch):
            # Pure dependent / mark: never starts a syllable.
            continue
        else:
            # Non-Burmese codepoint (ASCII, space, punctuation, other script).
            breaks.append(i)
            # Also break *after* it so a single foreign codepoint stays alone.
            if i + 1 < n:
                breaks.append(i + 1)

    breaks.append(n)
    # Deduplicate while preserving order; consecutive same indices collapse.
    out: list[str] = []
    for a, b in zip(breaks[:-1], breaks[1:], strict=True):
        if a < b:
            out.append(text[a:b])
    return out
