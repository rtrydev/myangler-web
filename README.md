# Myangler

An offline-first Burmese ↔ English dictionary, served as a static PWA.

The dictionary, fuzzy-search indexes, and Burmese word-segmentation model are all bundled into the site and run entirely in the browser — there is no backend. Once loaded, the app works offline. Live at [myangler.rtrydev.com](https://myangler.rtrydev.com).

## What it does

- **Forward lookup** — Burmese headword → glosses, IPA, part of speech, inflected forms. On a clean miss the engine retries against contiguous syllable sub-sequences, so segmenter-emitted compounds (e.g. `ညီမလေး` → `ညီမ`) still resolve.
- **Reverse lookup** — English word(s) → ranked Burmese entries (exact / head / incidental tiers, merged with fuzzy hits). Results are gated by a relevance threshold (matched word must be among the entry's top-N glosses) and fuzzy is suppressed below a length floor so short queries don't drag in unrelated near-matches.
- **Burmese search box** — exact match + syllable-level fuzzy match.
- **Word segmentation** — pastes of running Burmese text are segmented into tappable words (Viterbi + unigram/bigram model, ported from [myWord](https://github.com/ye-kyaw-thu/myWord)).
- **Forms / peers panel** — entries sharing a top-K gloss are surfaced together on the detail view, scored bidirectionally by gloss position so loosely-related noise stays out.
- **History & favorites** — persisted to `localStorage`.
- **Installable PWA** — `display: standalone`, parchment-and-lacquer themed, light + dark + four accents (ruby / gold / jade / indigo). The Settings sheet surfaces data-source attribution.

## Stack

- **Next.js 16** with `output: "export"` and `trailingSlash: true` (static SSG, no server).
- **React 19**, TypeScript, Tailwind v4.
- **sql.js** (SQLite compiled to WebAssembly) for the dictionary database.
- **Vitest** + Testing Library (jsdom) for tests.
- **Terraform** + AWS (S3 + CloudFront + ACM + Route 53) for hosting.

## Repository layout

```
app/
  components/     Design-system primitives (Button, Chip, SearchInput, EntryDetail, …)
  views/          Page-level views (AppShell, SearchContent, History/Favorites/Settings)
  system/         /system showcase route — live reference for every component & token
  lib/
    lookup/       Dictionary engine: sql.js loader, forward/reverse/fuzzy lookup, BK-trees
    segmenter/    Burmese segmenter (Viterbi) + syllable segmenter
    search/       Orchestrator: detects script, routes to segmenter + lookup
    app/          React context (EngineProvider), useHistory, useFavorites
  globals.css     Design tokens (--bg, --ink-*, --gold, --ruby, …) + dark-mode overrides
  manifest.ts     Web App Manifest
data/             Raw inputs (git-ignored): engmyan/, myword/, optional kaikki dump
tools/
  data-pipeline/
    src/          Python CLI package (data_pipeline.cli)
    scripts/      One-shot helpers — download_engmyan.py fetches the HF dataset
    reference/    Vendored, corrected myWord segmenter (parity target)
    tests/        pytest suite
myWord/           Vendored upstream (source of the n-gram pickles)
public/data/      Bundled runtime assets (generated; not committed)
scripts/deploy.sh One-shot terraform-apply + build + S3 sync + CloudFront invalidation
terraform/        AWS hosting stack
LICENSES/         Data-source license notices (data-sources.md)
docs/burmese-dictionary-spec.md   Authoritative spec for the data pipeline & engine
```

`AGENTS.md` is the design-system contract — **read it before adding UI**. Every reusable primitive already exists in `app/components/`; building one-off buttons / chips / search inputs is not allowed. The `/system` route is the live reference.

## Getting started

```bash
npm install                    # postinstall copies sql-wasm.wasm into public/
npm run sync:frontend-assets   # copy dictionary.sqlite, bktree-*.json, ngram.json into public/data
npm run dev                    # http://localhost:3000
```

`sync:frontend-assets` expects the data pipeline to have already produced the assets in `tools/data-pipeline/build/`. If you don't have them locally, run the pipeline (below) or pull them from someone who has.

Individual sync scripts:

```bash
npm run sync:segmenter-asset   # ngram.json
npm run sync:lookup-assets     # dictionary.sqlite + bktree-en.json + bktree-my.json
npm run sync:sqljs-wasm        # sql-wasm.wasm (also runs on postinstall)
```

## Testing

```bash
npm test           # vitest run
npm run test:watch
npm run test:ui
```

Notable suites:

- `app/lib/lookup/*.test.ts` — end-to-end against a fixture SQLite DB; covers tiering, merging, fuzzy, the compound fallback, and the relevance gate.
- `app/lib/segmenter/parity.test.ts` — TS port vs. the corrected Python reference (`tools/data-pipeline/reference/myword/`) over a shared corpus.
- `app/views/*.test.tsx` — view-level tests driven through `buildAppFixture`.
- `app/components/*.test.tsx` — co-located component tests; assert by role / label / text.
- `tools/data-pipeline/tests/` — pytest suite covering the inversion (`test_engmyan.py`), hybrid merge (`test_merge.py`), and end-to-end pipeline (`test_all_pipeline.py`).

## Data pipeline

The runtime assets are produced by `tools/data-pipeline/` — a stdlib-only Python CLI driven by `docs/burmese-dictionary-spec.md`.

### Inputs

- **`data/engmyan/engmyan.jsonl`** (required) — text-only extract of the
  [EngMyanDictionary HuggingFace dataset](https://huggingface.co/datasets/chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary)
  (GPL-2.0). The dataset is English-keyed; the pipeline's `engmyan` step parses each
  row's HTML/raw Myanmar definition into discrete Burmese terms and **inverts** the
  rows into Burmese-keyed entries before the rest of the chain runs. See spec §3.1
  and `tools/data-pipeline/README.md`.
- **`data/dictionary-burmese.jsonl`** (optional kaikki overlay) — when present, the
  legacy kaikki Burmese Wiktionary extract is layered on top of the EngMyan entries.
  **kaikki wins on shared headwords**, so its dedicated POS-specific particle entries
  (`တယ်`, `တဲ့`, `ပါ` as particle…) — which EngMyan's English-keyed shape cannot
  capture — stay in place. Drop the file or point `--kaikki-input` at a non-existent
  path to disable.
- **`data/myword/word_uni_gram.pkl`, `word_bi_gram.pkl`** — n-gram pickles from `myWord/`.

All three input paths are git-ignored. The EngMyan extract is fetched on demand by
the helper script described below.

### Outputs

Land in `tools/data-pipeline/build/`, then get synced into `public/data/`:

- `dictionary.sqlite` — `entries` table + `postings_en` inverted index with tier flags.
- `bktree-en.json` — character-level Levenshtein BK-tree over English gloss words.
- `bktree-my.json` — syllable-level Levenshtein BK-tree over Burmese headwords.
- `ngram.json` — unigram + bigram tables for the segmenter.
- `version.json` — UTC build-timestamp stamp the service worker keys cache on.

The `all` chain fails the build if `dictionary.sqlite` exceeds the configured ceiling
(`MAX_DB_SIZE_BYTES`, 80 MiB) — a guard against the EngMyan image columns
re-entering the bundle.

### Running it

```bash
python -m venv venv && source venv/bin/activate     # first time only
pip install -e tools/data-pipeline                  # installs the CLI
pip install -e "tools/data-pipeline[download]"      # optional: HF downloader deps

python tools/data-pipeline/scripts/download_engmyan.py   # one-shot input fetch
data-pipeline all                                        # build every shipped asset
```

The downloader projects the parquet shards down to text columns at read time, so the
~950 MB image blobs in the upstream dataset never materialize on disk. Without the
JSONL the `engmyan` step exits 1 with an actionable instruction (no stack trace).

Individual steps (`data-pipeline engmyan`, `index-en`, `build-db`, `bktree-en`,
`bktree-my`, `convert-ngram`, `version`, `report`) are runnable in isolation; see
`tools/data-pipeline/README.md` for the per-step contracts.

> **Note on bigrams.** Upstream myWord looks up bigrams as space-joined strings while the pickle stores tuple keys — every lookup falls through to unigrams. Both the TS segmenter and the vendored reference (`tools/data-pipeline/reference/myword/word_segment.py`) use tuple keys; `parity.test.ts` keeps them in lock-step.

## Data sources & licenses

The **shipped `dictionary.sqlite` is a derived work under GPL-2.0**, inherited from the EngMyanDictionary dataset. Redistributions must comply. Attribution is surfaced in-app (Settings → Data sources) and the full breakdown lives in [`LICENSES/data-sources.md`](LICENSES/data-sources.md):

- `dictionary.sqlite`, `bktree-en.json`, `bktree-my.json` — derived from **EngMyanDictionary** by Soe Minn Minn (GPL-2.0), via the [chuuhtetnaing HuggingFace dataset](https://huggingface.co/datasets/chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary).
- `ngram.json` — derived from **myWord** by Ye Kyaw Thu (GPL-3.0).
- Pre-v1 builds shipped a CC-BY-SA Wiktionary derivative via [kaikki.org](https://kaikki.org/); that data is no longer the primary source. The kaikki overlay path is optional and only ever supplies Burmese-keyed entries the user provides locally.

## Deploying

```bash
./scripts/deploy.sh            # interactive terraform apply, then build + push
./scripts/deploy.sh --yes      # auto-approve terraform apply
```

The script:

1. `aws sts get-caller-identity` — fail fast if the session is gone.
2. `aws configure export-credentials --format env` (AWS CLI v2) so Terraform sees the same identity.
3. `terraform -chdir=terraform apply` — converge the stack.
4. `npm run sync:frontend-assets && npm run build` — static export to `out/`.
5. `aws s3 sync out/ s3://<bucket>` with split cache headers (immutable for fingerprinted assets, 60s for HTML/JSON/manifest).
6. `aws cloudfront create-invalidation --paths '/*'`.

See [terraform/README.md](terraform/README.md) for the stack itself (private S3 + OAC, CloudFront with a URL-rewrite function, DNS-validated ACM cert, Route 53 aliases).

## Further reading

- [AGENTS.md](AGENTS.md) — design-system rules (mandatory for UI work).
- [docs/burmese-dictionary-spec.md](docs/burmese-dictionary-spec.md) — data pipeline & lookup engine spec.
- [tools/data-pipeline/README.md](tools/data-pipeline/README.md) — pipeline CLI, per-step contracts, downloader.
- [LICENSES/data-sources.md](LICENSES/data-sources.md) — full data-asset license breakdown.
- [terraform/README.md](terraform/README.md) — hosting stack.
