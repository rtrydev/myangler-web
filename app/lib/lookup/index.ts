// Public entry point of the framework-agnostic dictionary lookup module.
//
// No React / Next imports — this is a plain TypeScript library so the
// app, tests, or any other surface can import it directly. Pair this
// with `@/app/lib/segmenter` (whose syllable tokenizer this module
// imports for Burmese fuzzy lookup).

export {
  loadDictionary,
  BKTreeFormatError,
  type DictionaryModel,
} from "./loader";

export { lookupForward, lookupForwardWithFuzzy } from "./forward";
export { lookupReverse } from "./reverse";
export { searchBurmese } from "./burmeseSearch";

export { normalizeGloss, tokenizeGlossWords } from "./normalize";

export {
  BKTREE_FORMAT_TAG,
  editDistance,
  syllableDistance,
} from "./bktree";

export {
  Tier,
  DEFAULT_CONFIG,
  type TierValue,
  type Entry,
  type ForwardResult,
  type ResultRow,
  type LookupConfig,
  type AssetSources,
} from "./types";
