// Script detection — the routing decision at the heart of the
// orchestrator.
//
// The rule (pragmatic; deterministic; independently tested):
//
//   - Burmese: contains at least one codepoint in the Myanmar block
//     (U+1000–U+109F), Myanmar Extended-A (U+AA60–U+AA7F), or Myanmar
//     Extended-B (U+A9E0–U+A9FF).
//   - Latin: contains at least one ASCII letter (a-z / A-Z) AND no
//     Burmese codepoints.
//   - Mixed: contains at least one Burmese codepoint AND at least one
//     ASCII letter.
//   - Unknown: neither (digits-only, punctuation-only, other scripts).
//
// Neutral characters — digits, whitespace, ASCII punctuation, common
// symbols — do not by themselves determine script.

import type { Script } from "./types";

function isBurmeseCodepoint(cp: number): boolean {
  // Myanmar (primary block).
  if (cp >= 0x1000 && cp <= 0x109f) return true;
  // Myanmar Extended-B (note: this block has the lower numeric range,
  // listed second to match the textbook label).
  if (cp >= 0xa9e0 && cp <= 0xa9ff) return true;
  // Myanmar Extended-A.
  if (cp >= 0xaa60 && cp <= 0xaa7f) return true;
  return false;
}

function isLatinLetter(cp: number): boolean {
  // ASCII letters only. Non-ASCII Latin (accented letters, etc.) is
  // intentionally excluded — the reverse-lookup index keys on ASCII
  // gloss-words, and the build pipeline does not normalize diacritics.
  return (
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) // a-z
  );
}

/** Classify a string by script. The result drives the orchestrator's
 *  routing decision; see the module README for the table of routes.
 *
 *  Empty / whitespace-only input is `unknown` (the caller is expected to
 *  branch on empty *before* calling this, but the rule is well-defined
 *  for completeness). */
export function detectScript(input: string): Script {
  let hasBurmese = false;
  let hasLatin = false;
  for (let i = 0; i < input.length; i++) {
    const cp = input.charCodeAt(i);
    // Burmese characters all live in the BMP — no need to handle
    // surrogate pairs for the script-decision codepoints. We still skip
    // the low half of any surrogate pair so a stray non-BMP character
    // does not double-count.
    if (cp >= 0xd800 && cp <= 0xdbff) {
      i++;
      continue;
    }
    if (isBurmeseCodepoint(cp)) {
      hasBurmese = true;
    } else if (isLatinLetter(cp)) {
      hasLatin = true;
    }
    // Early exit once we've seen both.
    if (hasBurmese && hasLatin) return "mixed";
  }
  if (hasBurmese) return "burmese";
  if (hasLatin) return "latin";
  return "unknown";
}
