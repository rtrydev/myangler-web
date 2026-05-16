# `app/lib/search` — search orchestrator

Framework-agnostic TypeScript module that decides what to do with a
single user input string and returns a structured result describing
what the UI should display. No React / Next imports — this is glue
between [`app/lib/segmenter`](../segmenter/) and
[`app/lib/lookup`](../lookup/), nothing else.

The orchestrator owns the **routing decisions** (Burmese sentence
breakdown vs. English reverse lookup vs. single-word search vs. empty
vs. too-long vs. unrecognized). The engines themselves — segmentation,
forward / reverse / Burmese-search lookup, normalization, fuzzy — live
in the sibling modules and are imported, not re-implemented.

Behavioral contract: [`docs/burmese-dictionary-spec.md`](../../../docs/burmese-dictionary-spec.md),
particularly **§2.1** (input handling + length cap),
**§2.2** (sentence breakdown, eager per-token gloss preview),
**§2.3 / 2.4** (forward / reverse + tiered ranking), and **§2.5**
(bidirectional fuzzy).

## Files

| File | Responsibility |
|---|---|
| `orchestrator.ts` | `load`, `search`, `singleWordSearch`. The routing logic. |
| `scriptDetect.ts` | `detectScript` — Burmese / Latin / mixed / unknown classifier. Independently tested. |
| `types.ts` | The discriminated-union `SearchResult` / `SingleWordResult` types and supporting interfaces. |
| `config.ts` | `SearchConfig` + `DEFAULT_CONFIG` (length cap). |
| `index.ts` | Re-exports the public surface. |

## Public API

```ts
import {
  load,               // (input, config?) => Promise<SearchEngine>
  search,             // (engine, input) => SearchResult
  singleWordSearch,   // (engine, input) => SingleWordResult

  detectScript,       // (text) => "burmese" | "latin" | "mixed" | "unknown"

  DEFAULT_CONFIG,
  type SearchEngine,
  type SearchConfig,
  type LoadInput,
  type SearchResult,
  type SingleWordResult,
  type BreakdownToken,
  type Script,
} from "@/app/lib/search";
```

### Load-once, query-many

```ts
// Production: load the engines once at startup, then hand them to the
// orchestrator. (Dependency injection — the orchestrator does not own
// a global singleton.)
import { loadNgramModel } from "@/app/lib/segmenter";
import { loadDictionary } from "@/app/lib/lookup";

const [segmenter, dictionary] = await Promise.all([
  loadNgramModel("/data/ngram.json"),
  loadDictionary({
    kind: "urls",
    sqlite:    "/data/dictionary.sqlite",
    bktreeEn:  "/data/bktree-en.json",
    bktreeMy:  "/data/bktree-my.json",
    wasmUrl:   "/sql-wasm.wasm",
  }),
]);
const engine = await load({ kind: "preloaded", segmenter, dictionary });

// Then call synchronously, as many times as the UI needs.
search(engine, "မြန်မာစကားပြောတယ်");
search(engine, "water");
singleWordSearch(engine, "မြန်မာ");
```

`load` is idempotent: a second call with the same `LoadInput` object
returns the cached promise. The query functions are **synchronous and
pure** given a loaded `SearchEngine`.

#### Source-based loading (tests / one-shot scripts)

```ts
const engine = await load({
  kind: "sources",
  ngramUrl: "/data/ngram.json",
  dictionarySources: {
    kind: "urls",
    sqlite:   "/data/dictionary.sqlite",
    bktreeEn: "/data/bktree-en.json",
    bktreeMy: "/data/bktree-my.json",
  },
});
```

The `sources` form is convenience: it forwards to
`loadNgramModel` + `loadDictionary`. Production should prefer
`preloaded` so the two engines are loaded *once* and reused for any
other surface that wants them.

## Script detection rule

`detectScript(text)` classifies a string by Unicode codepoint scan:

| Result    | When |
|-----------|------|
| `burmese` | Contains at least one codepoint in U+1000–U+109F (Myanmar), U+AA60–U+AA7F (Extended-A), or U+A9E0–U+A9FF (Extended-B); contains no ASCII letters. |
| `latin`   | Contains at least one ASCII letter (a-z / A-Z); contains no Burmese codepoints. |
| `mixed`   | Contains both. |
| `unknown` | Neither (digits-only, punctuation-only, other scripts, empty). |

Neutral characters — digits, whitespace, ASCII punctuation, common
symbols — never on their own classify a string. Non-ASCII Latin
(accented letters like `ñ`) is intentionally **not** treated as Latin:
the reverse-lookup index keys on ASCII gloss-words, so routing such
input to the English path would just produce empty results. Strings
containing both accented and ASCII letters (e.g. `café`) still classify
as Latin because the ASCII letters trigger the rule.

## Routing decisions

| `detectScript` | `search()` route | Notes |
|---|---|---|
| `burmese` | Word-segment; **≥ 2 tokens** → eager exact forward-lookup per token → `breakdown`. **1 token** → `searchBurmese` → `reverse` (`script: "burmese"`). | Spec §2.2 for the breakdown path; the single-block collapse mirrors the Latin path so the search-tab view is driven by `segmented.length`, not script. |
| `mixed`   | Same as Burmese, with `mixedInput: true` on a `breakdown` result. (A mixed input that collapses to one segmented token also falls into the `reverse` branch.) | Burmese segmenter handles non-Burmese runs per Task 04. |
| `latin`   | English-segment; **≥ 2 segments** → `breakdown`. **1 segment** → `lookupReverse` → `reverse` (`script: "latin"`). | Spec §2.4. The single-segment collapse covers natural single words, known multi-word phrases ("new year"), article-absorbed runs ("a fish"), and "to <verb>" infinitives. |
| `unknown` | `unrecognized` — no engine call | |
| empty after trim | `empty` — no engine call | |
| over the length cap | `too_long` — no engine call | Cap is checked *before* trim, against the raw input. |

`singleWordSearch()` shares the empty / too-long / unrecognized
handling, but routes the real script classes differently:

| `detectScript` | `singleWordSearch()` route |
|---|---|
| `burmese` or `mixed` | `searchBurmese` (exact headword + syllable fuzzy) → `single_word` (`script: "burmese"`) |
| `latin` | `lookupReverse` → `single_word` (`script: "latin"`) |

### Eager per-token lookup uses **exact only**, not fuzzy

In the Burmese (and mixed) breakdown, each segmented token is looked
up via `lookupForward` — exact only. `lookupForwardWithFuzzy` is
**deliberately not used** here.

Rationale: per-token fuzzy fallback at segmentation time would surface
spurious previews for the many tokens that are particles, punctuation,
or non-Burmese runs (in mixed input). A miss is preferable to a
near-syllable rescue that the user didn't ask for. Fuzzy is available
on demand via `singleWordSearch` for a single Burmese word, or by
calling the lookup module's `lookupForwardWithFuzzy` directly on a
specific token if the UI later adds a "did you mean?" affordance per
block.

### Single-block inputs collapse to `reverse`, regardless of script

Whenever segmentation produces exactly one block, `search()` returns
`{ kind: "reverse", script, rows }` — the ranked single-word view —
rather than a one-tile breakdown. This holds for both the Burmese path
(routed through `searchBurmese`: exact headword + syllable fuzzy + top-N)
and the Latin path (routed through `lookupReverse`). The decision is
driven off `segmented.length`, not the surface shape of the input, so:

- A natural Burmese single word (`မြန်မာ`) and a Latin single word
  (`water`) both render as the ranked results list.
- An English input that collapses to one segment — a known multi-word
  phrase (`new year`), an article-absorbed run (`a fish`), or a
  `to <verb>` infinitive (`to be`) — also renders as `reverse`.
- Sentence inputs (≥ 2 segments) keep the tile breakdown.

This makes the search-tab view consistent: "one block in, single-word
view out." `singleWordSearch` remains available as a separate API
surface for callers that always want the search-box semantics regardless
of how the orchestrator's segmenters would route the input.

## Result shape

`SearchResult` is a discriminated union on `kind`:

```ts
type SearchResult =
  | { kind: "empty" }
  | { kind: "too_long"; limit: number; length: number }
  | { kind: "unrecognized" }
  | { kind: "breakdown"; script: "burmese" | "english";
      mixedInput: boolean;
      tokens: { token: string; result: ForwardResult | null }[] }
  | { kind: "reverse"; script: "burmese" | "latin"; rows: ResultRow[] };
```

`SingleWordResult` mirrors the edge-case kinds but its "real" kinds are:

```ts
type SingleWordResult =
  | { kind: "empty" }
  | { kind: "too_long"; limit: number; length: number }
  | { kind: "unrecognized" }
  | { kind: "single_word"; script: "burmese"; rows: ResultRow[] }
  | { kind: "single_word"; script: "latin";   rows: ResultRow[] };
```

The shape is **stable and serializable** — every payload is plain JSON
(no functions, no class instances, no `Date` / `Map`). It can be
passed across a worker boundary or persisted as-is.

### Worked examples

```ts
search(engine, "");
// → { kind: "empty" }

search(engine, " ".repeat(501)); // assuming default maxInputLength=500
// → { kind: "too_long", limit: 500, length: 501 }

search(engine, "12345");
// → { kind: "unrecognized" }

search(engine, "မြန်မာစကား");
// → {
//     kind: "breakdown",
//     script: "burmese",
//     mixedInput: false,
//     tokens: [
//       { token: "မြန်မာ", result: { entry: {...}, mergedPeers: [...] } },
//       { token: "စကား",   result: { entry: {...}, mergedPeers: [...] } },
//     ],
//   }

search(engine, "မြန်မာ");
// → { kind: "reverse", script: "burmese", rows: [...] }   // single-block collapse

search(engine, "မြန်မာ test");
// → { kind: "breakdown", script: "burmese", mixedInput: true, tokens: [...] }

search(engine, "water");
// → { kind: "reverse", script: "latin", rows: [...up to 10 ResultRows...] }

search(engine, "new year");
// → { kind: "reverse", script: "latin", rows: [...] }     // collapses to one segment

singleWordSearch(engine, "မြန်မာ");
// → { kind: "single_word", script: "burmese", rows: [...] }

singleWordSearch(engine, "water");
// → { kind: "single_word", script: "latin", rows: [...] }
```

## Configuration

```ts
DEFAULT_CONFIG = {
  maxInputLength: 500,  // codepoint cap on input; spec §2.1
};
```

Pass a partial override as the second argument to `load`. There is
intentionally no "treat mixed as Latin" toggle — the spec's behavior
(Burmese path with `mixedInput` flag) is the only supported behavior.
If a future requirement needs the alternative, add the option then.

## Dependencies

### `@/app/lib/segmenter`

Used for:

- `NgramModel` (the loaded segmenter model — the orchestrator stores
  this on `SearchEngine`).
- `segmentWords(model, input)` — the Burmese / mixed-input breakdown
  path. The segmenter strips ASCII spaces and trims internally; no
  pre-segmenter preprocessing happens in the orchestrator.
- `loadNgramModel(url)` — used only in the `sources`-mode load path.
- `parseNgramModel(json)` — used by tests via the fixture builder.

### `@/app/lib/lookup`

Used for:

- `DictionaryModel` (the loaded dictionary model).
- `lookupForwardWithCompoundFallback(model, headword)` — exact only,
  per segmented token (with a strict compound-fallback for segmenter-
  emitted compounds; never a BK-tree near-miss).
- `lookupReverse(model, query)` — Latin reverse lookup. The lookup
  module normalizes the query internally; the orchestrator does **not**
  duplicate normalization.
- `searchBurmese(model, query)` — single-word Burmese search box
  (exact + syllable fuzzy).
- `loadDictionary(sources)` — used only in the `sources`-mode load path.
- The shared `Entry`, `ForwardResult`, `ResultRow` types appear inside
  the result union.

The orchestrator **never** uses `lookupForwardWithFuzzy` — see the
"eager-exact" rationale above.

### Load-once expectation

Both sibling modules are designed for "load once, query many times."
The orchestrator inherits that pattern: `load` is async, every
subsequent `search` / `singleWordSearch` is synchronous. Pass
already-loaded engines via `kind: "preloaded"` to avoid any
re-initialization.

## Tests

Run with `npm test` (vitest, jsdom).

- `scriptDetect.test.ts` — independent tests for the Burmese / Latin /
  mixed / unknown rule (including neutral-character handling,
  whitespace edges, Extended-A/B blocks, and non-ASCII Latin).
- `orchestrator.test.ts` — fixture-engine tests for every result kind
  (empty / too-long / unrecognized / breakdown / reverse / single-word),
  hit-and-miss tokens in the breakdown, mixed-input flagging, the
  eager-exact policy, the single-block-collapses-to-reverse rule (for
  both scripts), load-once caching, and result-shape serializability.
- `smoke.test.ts` — loads the **real** synced `ngram.json` +
  `dictionary.sqlite` + BK-trees and exercises the orchestrator end to
  end. Skipped (with a placeholder) when assets are not synced.

The fixture builder
(`__fixtures__/buildSearchEngine.ts`) reuses the segmenter's
tiny-ngram fixture and the lookup module's `buildFixtureModel`, so the
orchestrator tests run against a real sql.js database and the real
Viterbi segmenter — no mocks of the engines themselves.

## Constraints

- **Framework-agnostic.** No React / Next imports.
- **No UI**, no debouncing, no history, no favorites, no service
  worker.
- **No re-implementation** of segmentation, lookup, normalization,
  fuzzy, or syllable handling.
- **Eager per-token lookup uses exact (`lookupForward`) only.**
- The orchestrator **accepts already-loaded engines** via dependency
  injection. It does not own a global singleton.
- The result type is a **discriminated union, stable, serializable**.
- The length cap is enforced as a **hard pre-check**; over-long input
  is never passed to the segmenter.
