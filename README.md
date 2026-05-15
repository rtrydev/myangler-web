# Myangler

An offline-first Burmese ↔ English dictionary, served as a static PWA.

The dictionary, fuzzy-search indexes, and Burmese word-segmentation model are all bundled into the site and run entirely in the browser — there is no backend. Once loaded, the app works offline. Live at [myangler.rtrydev.com](https://myangler.rtrydev.com).

## What it does

- **Forward lookup** — Burmese headword → glosses, IPA, part of speech, inflected forms.
- **Reverse lookup** — English word(s) → ranked Burmese entries (exact / head / incidental tiers, merged with fuzzy hits).
- **Burmese search box** — exact match + syllable-level fuzzy match.
- **Word segmentation** — pastes of running Burmese text are segmented into tappable words (Viterbi + unigram/bigram model, ported from [myWord](https://github.com/ye-kyaw-thu/myWord)).
- **History & favorites** — persisted to `localStorage`.
- **Installable PWA** — `display: standalone`, parchment-and-lacquer themed, light + dark + four accents (ruby / gold / jade / indigo).

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
    lookup/       Dictionary engine: sql.js loader, forward/reverse/fuzzy lookup
    segmenter/    Burmese segmenter (Viterbi) + syllable segmenter
    search/       Orchestrator: detects script, routes to segmenter + lookup
    app/          React context (EngineProvider), useHistory, useFavorites
  globals.css     Design tokens (--bg, --ink-*, --gold, --ruby, …) + dark-mode overrides
  manifest.ts     Web App Manifest
data/             Raw inputs: Wiktionary JSONL extract + myWord pickles (not shipped)
tools/
  data-pipeline/  Python CLI that turns raw inputs into the bundled assets
myWord/           Vendored upstream (source of the n-gram pickles)
public/data/      Bundled runtime assets (generated; not committed)
scripts/deploy.sh One-shot terraform-apply + build + S3 sync + CloudFront invalidation
terraform/        AWS hosting stack
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

- `app/lib/lookup/*.test.ts` — end-to-end against a fixture SQLite DB; covers tiering, merging, fuzzy.
- `app/lib/segmenter/parity.test.ts` — TS port vs. the corrected Python reference (`tools/data-pipeline/reference/myword/`) over a shared corpus.
- `app/views/*.test.tsx` — view-level tests driven through `buildAppFixture`.
- `app/components/*.test.tsx` — co-located component tests; assert by role / label / text.

## Data pipeline

The runtime assets are produced by `tools/data-pipeline/` — a stdlib-only Python CLI driven by `docs/burmese-dictionary-spec.md`.

Inputs:

- `data/dictionary-burmese.jsonl` — Burmese Wiktionary extract (from [kaikki.org](https://kaikki.org/)).
- `data/myword/word_uni_gram.pkl`, `word_bi_gram.pkl` — n-gram pickles from `myWord/`.

Outputs (in `tools/data-pipeline/build/`, then synced into `public/data/`):

- `dictionary.sqlite` — `entries` table + `postings_en` inverted index with tier flags.
- `bktree-en.json` — character-level Levenshtein BK-tree over English gloss words.
- `bktree-my.json` — syllable-level Levenshtein BK-tree over Burmese headwords.
- `ngram.json` — unigram + bigram tables for the segmenter.

Run with the project venv:

```bash
python -m venv venv && source venv/bin/activate     # first time only
python -m tools.data_pipeline all                   # runs every step
```

> **Note on bigrams.** Upstream myWord looks up bigrams as space-joined strings while the pickle stores tuple keys — every lookup falls through to unigrams. Both the TS segmenter and the vendored reference (`tools/data-pipeline/reference/myword/word_segment.py`) use tuple keys; `parity.test.ts` keeps them in lock-step.

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
- [terraform/README.md](terraform/README.md) — hosting stack.
