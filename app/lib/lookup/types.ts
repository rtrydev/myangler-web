// Shared types for the dictionary-lookup module.
//
// The raw asset shapes mirror the contracts produced by
// `tools/data-pipeline/`:
//   - `bktree-en.json` and `bktree-my.json` use the `bktree/v1` JSON layout
//     documented in `tools/data-pipeline/README.md`.
//   - `dictionary.sqlite` carries the schema documented in the same README.
//
// The public-facing result shapes (forward, reverse, search results) are
// defined here too so the framework-agnostic API has a single source of
// truth.

/** Raw `bktree/v1` payload. The English tree stores strings (one
 *  gloss-word per node); the Burmese tree stores arrays of syllable
 *  strings (one headword per node, pre-segmented at build time). */
export interface BKTreeAsset<V> {
  format: "bktree/v1";
  size: number;
  root: number | null;
  nodes: V[];
  edges: Record<string, number>[];
}

/** Tier flag stored on each `postings` row (see
 *  `tools/data-pipeline/src/data_pipeline/steps/index_en.py::Tier`).
 *  Lower = higher priority. */
export const Tier = {
  EXACT: 0,
  HEAD: 1,
  INCIDENTAL: 2,
  /** Synthesized client-side for fuzzy-tier results — never present in the
   *  SQLite `postings` table. Lives outside the build-time tier set so the
   *  spec's "fuzzy fills remaining slots" policy is expressible with a
   *  single comparable number. */
  FUZZY: 3,
} as const;
export type TierValue = (typeof Tier)[keyof typeof Tier];

/** A Burmese entry as stored in the `entries` table, with its parallel
 *  `glosses` / `normalized_glosses` arrays already JSON-parsed. */
export interface Entry {
  entryId: number;
  headword: string;
  pos: string;
  glosses: string[];
  normalizedGlosses: string[];
  ipa: string | null;
}

/** Forward-lookup payload: the matched entry plus any sibling entries that
 *  share at least one identical normalized gloss (spec §2.4.3). The peers
 *  list is empty when no merging applies. */
export interface ForwardResult {
  entry: Entry;
  /** Other entries sharing one or more normalized glosses with `entry`,
   *  deduplicated. Empty when nothing merges. */
  mergedPeers: Entry[];
}

/** One row in a reverse-lookup or Burmese-search result list. A row is a
 *  group of entries that share a single normalized gloss (or — for
 *  Burmese search — a single headword). */
export interface ResultRow {
  /** Tier of the strongest contributor to this row. Drives ordering. */
  tier: TierValue;
  /** Whether the row was reached via the fuzzy tier (BK-tree). Convenience
   *  for callers that want to render fuzzy rows differently. */
  fuzzy: boolean;
  /** Edit distance for fuzzy rows; `0` for non-fuzzy rows. */
  distance: number;
  /** The normalized gloss this row keys on (reverse lookup) — or the
   *  matched headword (Burmese search). The grouping key. */
  key: string;
  /** Every entry that contributes to this row. For reverse lookup, all
   *  contributing entries share `key` as one of their normalized glosses
   *  (per spec §2.4.3). For Burmese search, all contributors share the
   *  matched headword. */
  entries: Entry[];
}

/** Configuration knobs exposed at load time. Defaults are baked from
 *  spec §2.5 / `tools/data-pipeline/src/data_pipeline/config.py`. */
export interface LookupConfig {
  /** Max edit distance for English fuzzy. Default 1. */
  fuzzyThresholdEn: number;
  /** Max edit distance for Burmese fuzzy (syllables). Default 1. */
  fuzzyThresholdMy: number;
  /** Hard cap on reverse-lookup / Burmese-search result rows. Spec §2.4.4
   *  pegs this at 10; exposed for tests. */
  resultLimit: number;
}

export const DEFAULT_CONFIG: LookupConfig = {
  fuzzyThresholdEn: 1,
  fuzzyThresholdMy: 1,
  resultLimit: 10,
};

/** Asset bundle the loader accepts. Either a URL pair (`browser` shape)
 *  or pre-fetched bytes / parsed payloads (`fixture` shape). */
export type AssetSources =
  | {
      kind: "urls";
      /** URL of `dictionary.sqlite`. */
      sqlite: string;
      /** URL of `bktree-en.json`. */
      bktreeEn: string;
      /** URL of `bktree-my.json`. */
      bktreeMy: string;
      /** Optional override for the sql.js WASM binary; if absent, sql.js
       *  resolves the binary itself. */
      wasmUrl?: string;
    }
  | {
      kind: "raw";
      /** Bytes of `dictionary.sqlite`. */
      sqlite: Uint8Array;
      /** Parsed `bktree-en.json` payload. */
      bktreeEn: unknown;
      /** Parsed `bktree-my.json` payload. */
      bktreeMy: unknown;
      /** Bytes of `sql-wasm.wasm`. Required in raw mode because Node has
       *  no `fetch` for arbitrary on-disk WASM paths by default. */
      wasm: ArrayBuffer | Uint8Array;
    };
