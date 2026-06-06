// Part-of-speech categorization for the breakdown color system.
//
// The dictionary stores `pos` as a free-form string ("n", "noun", "v",
// "verb", "adj", "adv", "phrase", "pron", particles, …). We collapse it
// into a small, stable set of categories so the breakdown tiles can be
// colored like a manuscript gloss — content words carry hue, function
// words stay neutral — mirroring the vocab/grammar/particle split in
// reference dictionaries.
//
// Colors are intentionally drawn from accent-PROOF tokens (`--gold`,
// `--swatch-ruby`, `--jade`, `--ink-3`): the accent picker only remaps
// `--ruby`, so a verb tile must not silently turn gold when the user
// selects the gold accent. See `app/globals.css`.

export type PosCategory = "noun" | "verb" | "modifier" | "other";

/** Collapse a raw `pos` string to a display category. Matching mirrors
 *  the conservative prefix logic in `englishSegment.isVerbPos` — accept
 *  genuine forms without sweeping in look-alikes ("pronoun" is NOT a
 *  noun; "proverb" is NOT a verb). */
export function posCategory(pos: string): PosCategory {
  const p = pos.trim().toLowerCase();
  if (p === "n" || p === "noun" || p.startsWith("noun ")) return "noun";
  if (p === "v" || p === "verb" || p.startsWith("verb ")) return "verb";
  if (
    p === "adj" ||
    p.startsWith("adject") ||
    p === "adv" ||
    p.startsWith("adverb")
  ) {
    return "modifier";
  }
  return "other";
}

/** Human-readable label for a category — used by the breakdown legend. */
export const POS_CATEGORY_LABEL: Record<PosCategory, string> = {
  noun: "Noun",
  verb: "Verb",
  modifier: "Modifier",
  other: "Other",
};

/** Legend / tile hue per category. MUST match the `.wblock.pos-*` rules
 *  in `app/globals.css`. Values are accent-PROOF design tokens so the
 *  legend stays put when the user remaps the accent. */
export const POS_CATEGORY_COLOR: Record<PosCategory, string> = {
  noun: "var(--gold)",
  verb: "var(--swatch-ruby)",
  modifier: "var(--jade)",
  other: "var(--ink-3)",
};

/** Ordered for legend display (content categories first, neutral last). */
export const POS_CATEGORY_ORDER: readonly PosCategory[] = [
  "noun",
  "verb",
  "modifier",
  "other",
];
