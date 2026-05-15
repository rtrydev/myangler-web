// Public entry point of the framework-agnostic search orchestrator.
//
// No React / Next imports — this is a plain TypeScript library. The
// orchestrator is the glue between `@/app/lib/segmenter` and
// `@/app/lib/lookup`; it does not own segmentation or lookup, only the
// routing decisions that decide which engine to invoke for which input.

export {
  load,
  search,
  singleWordSearch,
  type SearchEngine,
  type LoadInput,
} from "./orchestrator";

export { detectScript } from "./scriptDetect";

export { DEFAULT_CONFIG, type SearchConfig } from "./config";

export type {
  Script,
  BreakdownToken,
  SearchResult,
  EmptyResult,
  TooLongResult,
  UnrecognizedResult,
  BreakdownResult,
  ReverseResult,
  SingleWordResult,
  SingleWordBurmeseResult,
  SingleWordEnglishResult,
  Entry,
  ForwardResult,
  ResultRow,
} from "./types";
