// Query / gloss normalization helpers.
//
// These mirror — byte-for-byte where it matters — the build-time
// normalization in
// `tools/data-pipeline/src/data_pipeline/steps/strip.py::normalize_gloss`
// and `index_en.py::tokenize_gloss_words`. The reverse lookup depends on
// the *query* arriving in the same shape as the indexed gloss-words.

/** Normalize a gloss / English query (spec §2.4.1):
 *
 *  - lowercase
 *  - collapse internal whitespace
 *  - strip leading `"to "`
 *
 *  Identical to `data_pipeline.steps.strip.normalize_gloss`. */
export function normalizeGloss(text: string): string {
  let s = text.trim().toLowerCase();
  s = s.split(/\s+/u).filter(Boolean).join(" ");
  if (s.startsWith("to ")) {
    s = s.slice(3).replace(/^\s+/u, "");
  }
  return s;
}

// `[a-z0-9](?:[a-z0-9']*[a-z0-9])?` — a run of ASCII letters/digits with
// optional inner apostrophes, the same regex the build step uses.
// Mirrored exactly so that whatever tokens landed in the inverted index
// at build time are the tokens the query is split into here.
const WORD_RE = /[a-z0-9](?:[a-z0-9']*[a-z0-9])?/g;

/** Split a *normalized* gloss / query into gloss-words. The caller is
 *  responsible for normalizing first (see `normalizeGloss`). */
export function tokenizeGlossWords(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.match(WORD_RE) ?? [];
}
