# `app/lib/lookup` — dictionary lookup engine

Framework-agnostic TypeScript module that answers Burmese ↔ English
dictionary queries client-side, against the static assets produced by
[`tools/data-pipeline/`](../../../tools/data-pipeline/). No React /
Next imports — this is a plain library the app, tests, or any other
surface can consume.

The authoritative behavioral contract lives in
[`docs/burmese-dictionary-spec.md`](../../../docs/burmese-dictionary-spec.md)
— particularly **§2.3** (forward), **§2.4** (reverse + tiered ranking +
merging), **§2.5** (fuzzy, both directions), **§3.4** (SQLite schema),
and **§6** (build pipeline). This module is the runtime side of those
sections.

## Files

| File | Responsibility |
|---|---|
| `loader.ts` | Async `loadDictionary` — fetches/wires sql.js, the SQLite DB, and both BK-trees; validates each format-tagged asset on load. |
| `sqlite.ts` | sql.js init + prepared-statement wrapper (`DictionaryDB`). Every query is parameterized; the module never mutates the DB. |
| `bktree.ts` | Re-hydrates the `bktree/v1` flat JSON into a queryable in-memory tree; iterative range search (Burmese headword trees can be >1300 levels deep). |
| `forward.ts` | `lookupForward` (Burmese → entry) and `lookupForwardWithFuzzy` (exact-then-syllable-fuzzy). |
| `reverse.ts` | `lookupReverse` (English → ranked top-10) — tiered ranking, merging, fuzzy inclusion. |
| `burmeseSearch.ts` | `searchBurmese` (user-typed Burmese search box) — exact headword + syllable fuzzy with the same merging / cap. |
| `normalize.ts` | Query / gloss normalization mirroring the build-time normalization. |
| `types.ts` | `Entry`, `ResultRow`, `Tier`, `LookupConfig`, `AssetSources`. |
| `index.ts` | Re-exports the public surface. |

## Public API

```ts
import {
  // Asset loading
  loadDictionary,            // (sources, config?) => Promise<DictionaryModel>
  BKTreeFormatError,         // thrown on bktree/v1 format-tag mismatch

  // Burmese → English
  lookupForward,             // (model, headword) => ForwardResult | null
  lookupForwardWithFuzzy,    // (model, headword) => ResultRow[]

  // English → Burmese (tiered ranking)
  lookupReverse,             // (model, query) => ResultRow[]

  // Burmese search box (exact + syllable fuzzy)
  searchBurmese,             // (model, query) => ResultRow[]

  // Helpers
  normalizeGloss, tokenizeGlossWords,
  editDistance, syllableDistance,

  // Types & constants
  Tier, DEFAULT_CONFIG,
  type Entry, type ResultRow, type ForwardResult,
  type DictionaryModel, type LookupConfig, type AssetSources,
} from "@/app/lib/lookup";
```

### Load-once, query-many

```ts
const model = await loadDictionary({
  kind: "urls",
  sqlite:    "/data/dictionary.sqlite",
  bktreeEn:  "/data/bktree-en.json",
  bktreeMy:  "/data/bktree-my.json",
  wasmUrl:   "/sql-wasm.wasm",   // optional; see "Hosting sql.js" below
});

lookupForward(model, "မြန်မာ");
lookupReverse(model, "go up");
searchBurmese(model, "မြန်မာ");
```

`loadDictionary` is async (it fetches the WASM binary, the SQLite file,
and both JSON BK-trees). Every query function is **synchronous and
pure** — call them as many times as you like against the same model.

A second `loadDictionary` call with the **same** `AssetSources` object
returns the cached promise — it does not re-fetch. To force a fresh
load, pass a fresh `sources` object.

### `AssetSources` discriminated union

The loader accepts either of:

```ts
// Browser / PWA path — URLs are fetched.
{ kind: "urls", sqlite, bktreeEn, bktreeMy, wasmUrl? }

// Node / test path — bytes and parsed payloads are provided directly.
{ kind: "raw",  sqlite: Uint8Array, bktreeEn: unknown,
                bktreeMy: unknown,  wasm: ArrayBuffer | Uint8Array }
```

The `raw` path is what the test fixtures use; the production app uses
the `urls` path.

### Configuration

```ts
DEFAULT_CONFIG = {
  fuzzyThresholdEn: 1,   // English character-edit threshold (spec §2.5)
  fuzzyThresholdMy: 1,   // Burmese syllable-edit threshold (spec §2.5)
  resultLimit: 10,       // top-10 cap on reverse / Burmese-search (§2.4.4)
};
```

Pass a partial override as the second argument to `loadDictionary`. The
two fuzzy thresholds are **independent per direction** — one syllable
edit and one character edit are not equivalent in strictness.

## Asset dependencies

The module consumes three files produced by `tools/data-pipeline/`:

| File | Format | Built by |
|---|---|---|
| `dictionary.sqlite` | SQLite (schema in `tools/data-pipeline/README.md`) | `data-pipeline build-db` |
| `bktree-en.json`    | `bktree/v1` (char-level) | `data-pipeline bktree-en` |
| `bktree-my.json`    | `bktree/v1` (syllable-level) | `data-pipeline bktree-my` |

Both JSON BK-trees carry a `"format": "bktree/v1"` discriminator; the
loader validates it and throws `BKTreeFormatError` on mismatch. The
SQLite file has no format tag — its contract is the schema itself,
verified at query time.

### Sync to `public/data/`

The PWA serves the assets from `/data/…`. They are **not committed** —
the data-pipeline output is the single source of truth and `public/data/`
is git-ignored to prevent drift.

```bash
# Refresh the lookup module's three assets:
npm run sync:lookup-assets

# Refresh all frontend assets (lookup + segmenter n-gram):
npm run sync:frontend-assets
```

`sync:lookup-assets` calls
[`scripts/sync-assets.mjs`](scripts/sync-assets.mjs), a thin file copy
from `tools/data-pipeline/build/` to `public/data/`. Don't hand-edit
the synced files; rebuild the pipeline.

## Hosting sql.js (the WASM detail)

`sql.js` is SQLite compiled to WebAssembly. The JavaScript loader is
shipped via `node_modules/sql.js/dist/sql-wasm.js`; the WASM binary
sits beside it at `node_modules/sql.js/dist/sql-wasm.wasm`.

Two ways to get the WASM to the browser:

1. **Pass a URL via `wasmUrl`** (recommended for Next.js). Copy the
   binary into `public/` (e.g. as `public/sql-wasm.wasm`) and pass
   `wasmUrl: "/sql-wasm.wasm"` to `loadDictionary`. The loader then
   wires sql.js's `locateFile` to that URL.
2. **Let sql.js resolve it**. If `wasmUrl` is omitted, sql.js looks for
   the binary next to `sql-wasm.js` — this only works when the bundle
   layout preserves that relationship (which Next.js's default build
   does **not**). The first option is the reliable choice.

In Node / test contexts the `raw` source variant takes a `wasm:
ArrayBuffer | Uint8Array` instead of a URL — see the test fixtures.

## Tiered ranking and merging — worked example

Suppose the fixture has these entries:

| id | headword | glosses |
|---|---|---|
| 0 | က  | `["go"]` |
| 1 | ခ  | `["to go"]` |
| 2 | ဂ  | `["go up"]` |
| 3 | ဃ  | `["soon to go"]` |
| 4 | ဇ  | `["got"]` |

The build-time normalization step turns `"to go"` into `"go"`, so
entries 0 and 1 share the normalized gloss `"go"`. The inverted index
records:

| word | tier | entry | gloss_index |
|---|---|---|---|
| `go` | EXACT | 0 | 0 |
| `go` | EXACT | 1 | 0 |
| `go` | HEAD | 2 | 0 |
| `up` | INCIDENTAL | 2 | 0 |
| `soon` | HEAD | 3 | 0 |
| `to` | INCIDENTAL | 3 | 0 |
| `go` | INCIDENTAL | 3 | 0 |
| `got` | EXACT | 4 | 0 |

Reverse-querying `"go"` then proceeds:

1. **Normalize**: `"go"` → `"go"` (already normalized).
2. **Real tiers**: scan postings for `word = "go"`, ordered by tier.
   Bucket the rows by the entry's normalized gloss:
   - bucket `"go"` ← entry 0 (EXACT), entry 1 (EXACT)
   - bucket `"go up"` ← entry 2 (HEAD)
   - bucket `"soon to go"` ← entry 3 (INCIDENTAL)
3. **Fuzzy tier**: BK-tree query for `"go"` at threshold 1 returns
   `["got", "to"]` (and `"go"` itself, which we skip). Each is then
   resolved through postings:
   - `"got"` → entry 4 with normalized gloss `"got"`: new bucket
     `"got"`, marked `fuzzy` with `distance: 1`.
   - `"to"` → entry 3 with normalized gloss `"soon to go"`: that bucket
     **already exists** from the real-tier pass — the fuzzy
     contribution does not flip the bucket to fuzzy or change its tier,
     it just dedupes (no new entry). This is the "fuzzy never preempts"
     rule (spec §2.4.2).
4. **Sort**: real rows first (tier ascending, then key ascending),
   then fuzzy rows (distance ascending, then key ascending). Cap at 10.

The output is four rows: `"go"` (EXACT, entries 0+1), `"go up"` (HEAD,
entry 2), `"soon to go"` (INCIDENTAL, entry 3), `"got"` (FUZZY, entry
4). Each row reflects the **highest** tier any of its contributors
hit; a `(HEAD, INCIDENTAL)` mix on the same bucket would resolve to a
HEAD row.

## Coupling to `@/app/lib/segmenter`

Burmese fuzzy lookup tokenizes the query into **syllables** and walks
the Burmese BK-tree using syllable-level edit distance. The tree was
**built** with the Python syllable segmenter
(`tools/data-pipeline/src/data_pipeline/syllable.py`), so the runtime
must use the **byte-identical** TypeScript port to avoid silent fuzzy
misses.

That port lives at `app/lib/segmenter/syllable.ts` and is re-exported
as `segmentSyllables`. This module imports it directly:

```ts
import { segmentSyllables } from "@/app/lib/segmenter";
```

Don't duplicate the segmenter here. Drift between the two would silently
break Burmese fuzzy. The segmenter's `parity.test.ts` plus the corpus
fixture pin the TS port to the corrected Python reference.

## Tests

Run with `npm test` (vitest, jsdom). Test files live next to the
implementation:

- `normalize.test.ts` — query/gloss normalization rules.
- `bktree.test.ts` — `bktree/v1` parse + validation + range query.
- `loader.test.ts` — format-tag rejection, load-once caching.
- `lookup.test.ts` — end-to-end coverage of every public function
  against an in-memory fixture: tier ordering, merging, fuzzy inclusion
  policy, both fuzzy directions, normalization, forward-with-fallback,
  Burmese search.
- `smoke.test.ts` — loads the **real** synced assets and exercises each
  public path once. Skipped (with a placeholder) when assets are not
  synced.

The lookup-test fixture (`__fixtures__/buildFixture.ts`) builds a real
sql.js database in memory using the same DDL as the data pipeline and
hand-rolled `bktree/v1` payloads, so the loader's validation and the
full pipeline of prepared queries run for every test.

## Constraints

- **Framework-agnostic.** No React/Next imports.
- **Read-only.** The module never mutates the SQLite database.
- **Prepared statements only.** Every query binds parameters.
- **No format drift.** Both BK-tree assets validate `format` on load.
- **Single source of truth for assets.** The data-pipeline output is
  authoritative; `public/data/` is a synced mirror.
