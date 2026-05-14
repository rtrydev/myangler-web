// Public entry point of the framework-agnostic Burmese segmenter.
//
// This module deliberately has no React / Next imports — it is a plain
// TypeScript library so it can be imported by the app, by tests, or by
// any other surface that needs Burmese segmentation.

export { segmentSyllables } from "./syllable";
export {
  segmentWords,
  segmentPrepared,
  preprocess,
} from "./wordSegmenter";
export {
  loadNgramModel,
  parseNgramModel,
  NgramFormatError,
  NGRAM_FORMAT_TAG,
  MYWORD_N,
} from "./loader";
export type { NgramAsset, NgramModel } from "./types";
