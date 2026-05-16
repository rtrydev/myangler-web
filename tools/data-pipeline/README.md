# data-pipeline

Build-time tool that ingests the **EngMyanDictionary** HuggingFace
dataset, **inverts** it into Burmese-keyed entries, and produces the
static assets shipped by the **myangler-web** PWA frontend (SQLite
database, BK-trees, version stamp).

It is a separate, auxiliary tool — it runs at build time on a developer
machine, reads from the repo's `data/` directory, and writes everything
into its own `build/` directory. The frontend app is not touched.

The authoritative description of what this pipeline must produce lives
in [`docs/burmese-dictionary-spec.md`](../../docs/burmese-dictionary-spec.md) —
in particular **§3 (Data)** and **§6 (Build Pipeline)**. Spec §3.1
documents the v1 source migration (from CC-BY-SA kaikki Wiktionary to
GPL-2.0 EngMyanDictionary) and the direction-inversion design.

## Status

| Step | Status | Notes |
|---|---|---|
| `load` | implemented | Streams & validates the JSONL extract |
| `engmyan` | implemented | **Primary loader.** Ingests EngMyanDictionary rows and inverts them into Burmese-keyed `StrippedEntry` records (spec §3.1, §6.2) |
| `strip` | implemented (back-compat) | Legacy kaikki loader. Not in the default `all` chain; kept for regression tests |
| `index-en` | implemented | English inverted index w/ exact/head/incidental tier flags |
| `merge-g2p` | **stub** | Optional myG2P coverage extension (spec §3.2) |
| `build-db` | implemented | SQLite DB w/ indexes, VACUUMed |
| `convert-ngram` | implemented | Faithful conversion of myWord pickled n-grams to JSON; no pruning |
| `bktree-en` | implemented | Char-level Levenshtein over gloss-words |
| `bktree-my` | implemented | Syllable-level Levenshtein over headwords |
| `version` | implemented | UTC build-timestamp stamp |
| `report` | implemented | Prints entry counts and asset sizes; enforces the DB size guard (spec §3.1.1) |
| `all` | implemented | Runs every implemented step in order |

`merge-g2p` remains a logging-only stub and is skipped by `all`. The
myWord **word segmenter port itself** lives on the frontend; this tool
only produces the n-gram **data asset** the segmenter consumes
(`ngram.json`).

A **corrected, vendored** Python reference implementation of the myWord
word segmenter also lives in this directory at
[`reference/myword/word_segment.py`](reference/myword/word_segment.py).
That reference is **not** part of the build pipeline — no `data-pipeline`
step imports it — and it exists only to (a) be the corrected algorithm
the TypeScript port is verified against and (b) regenerate
`app/lib/segmenter/__fixtures__/reference-corpus.json`. See
[`reference/README.md`](reference/README.md) for what was changed from
upstream and why.

## Requirements

- Python **3.13** (pinned in `.python-version`; `>=3.11` works in practice
  and is what `pyproject.toml` declares).
- The EngMyanDictionary text-only JSONL extract at
  `data/engmyan/engmyan.jsonl`
  (see [How to obtain the input](#how-to-obtain-the-engmyandictionary-input)
  below). Git-ignored; download it once with the helper script.
- The myWord **word-level** unigram + bigram pickles at `data/myword/`
  (see [`convert-ngram`](#convert-ngram-input-the-myword-pickles) below).
  These are large binary inputs, **not** committed; provide them yourself.

No third-party runtime dependencies for the pipeline itself — the core
implementation uses only the Python standard library (including the
bundled `sqlite3`). The one-shot downloader script
(`scripts/download_engmyan.py`) has optional build-time deps
(`huggingface_hub`, `pyarrow`) it imports lazily and reports a clean
install instruction if they are missing. Dev tools (pytest, ruff) live
in the `[dev]` extra.

## Setup

From the repo root:

```bash
# 1. Create the virtual environment (always lives in venv/ per AGENTS.md).
python -m venv venv
source venv/bin/activate

# 2. Install the tool in editable mode with dev dependencies.
pip install -e "tools/data-pipeline[dev]"
```

The install registers a `data-pipeline` console script and makes
`python -m data_pipeline` work from anywhere.

## Running the CLI

```bash
data-pipeline --help
data-pipeline all          # build every shipped asset
data-pipeline engmyan      # standalone: ingest+invert EngMyanDictionary
data-pipeline strip        # standalone: legacy kaikki loader (back-compat)
data-pipeline index-en     # standalone: build & summarize the index
data-pipeline build-db     # standalone: build the SQLite DB only
data-pipeline bktree-en    # standalone: build the English BK-tree
data-pipeline bktree-my    # standalone: build the Burmese BK-tree
data-pipeline convert-ngram  # standalone: convert the myWord pickles
data-pipeline version      # standalone: emit just the version stamp
data-pipeline report       # equivalent to `all` (rebuilds + prints summary)
```

Global options:

- `--input PATH`       Path to the EngMyanDictionary JSONL (default:
  `data/engmyan/engmyan.jsonl`, resolved against the repo root). When the
  back-compat `strip` subcommand is invoked with the default value, it
  transparently falls back to the legacy kaikki path
  `data/dictionary-burmese.jsonl`.
- `--output-dir PATH`  Where built assets land (default:
  `tools/data-pipeline/build/`).
- `--ngram-dir PATH`   Where the myWord pickles live (default:
  `data/myword/`). Used by `convert-ngram` and `all`.
- `-v` / `-vv`         Increase logging verbosity (info / debug).

`all` streams the input file **once** and reuses the stripped
representation across every downstream stage; individual subcommands run
standalone re-read the file (acceptable trade-off).

## Produced assets

`all` writes the following files into `--output-dir`. The frontend / service
worker consume these names directly.

| File | Format | Description |
|---|---|---|
| `dictionary.sqlite` | SQLite | Headword + glosses + English inverted index. Queried in-browser via `sql.js`. |
| `ngram.json`        | JSON   | myWord unigram + bigram counts feeding the JS Viterbi word segmenter (spec §4.2). |
| `bktree-en.json`    | JSON   | English BK-tree (char-level Levenshtein over gloss-words). |
| `bktree-my.json`    | JSON   | Burmese BK-tree (syllable-level Levenshtein over headwords). |
| `version.json`      | JSON   | Embedded version stamp for service-worker cache invalidation. |

### SQLite schema

Three tables, all simple enough for `sql.js` to handle without surprises:

```sql
CREATE TABLE entries (
    entry_id INTEGER PRIMARY KEY,
    headword TEXT NOT NULL,
    pos TEXT NOT NULL,
    glosses TEXT NOT NULL,            -- JSON array of display glosses
    normalized_glosses TEXT NOT NULL, -- JSON array, parallel to glosses
    ipa TEXT
);

CREATE TABLE postings (
    word TEXT NOT NULL,
    tier INTEGER NOT NULL,            -- 0 = exact, 1 = head, 2 = incidental
    entry_id INTEGER NOT NULL,
    gloss_index INTEGER NOT NULL,
    PRIMARY KEY (word, tier, entry_id, gloss_index)
) WITHOUT ROWID;

CREATE TABLE gloss_groups (
    normalized_gloss TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    PRIMARY KEY (normalized_gloss, entry_id)
) WITHOUT ROWID;

CREATE INDEX idx_entries_headword ON entries (headword);
```

- **Forward lookup**: `SELECT … FROM entries WHERE headword = ?` (uses
  `idx_entries_headword`).
- **Reverse lookup**: `SELECT … FROM postings WHERE word = ? ORDER BY tier`
  returns matches with tier already encoded — no re-parsing glosses
  client-side. The `(word, tier, …)` primary key serves as the
  reverse-lookup index.
- **Merge groups** (spec §2.4.3): every distinct normalized gloss appears
  in `gloss_groups` with one row per entry that shares it. After fetching
  postings, the frontend joins on `normalized_gloss` to collapse entries
  sharing a normalized gloss into a single merged result row.

After all writes the DB is `VACUUM`ed.

### BK-tree serialization (`bktree/v1`)

Both trees use the same flat JSON layout. A flat representation avoids
recursion-depth problems both in Python's `json` and in JavaScript loaders
(trees built from ~8k Burmese headwords can be ~1300 levels deep).

```json
{
  "format": "bktree/v1",
  "size":   8151,
  "root":   0,
  "nodes":  [<value0>, <value1>, ...],
  "edges":  [{<distance>: <child_idx>, ...}, ...]
}
```

- `nodes[i]` is the value at the BK-tree node with index `i`.
  - English tree: `<value>` is a `string` (one gloss-word).
  - Burmese tree: `<value>` is an `array<string>` of syllable clusters —
    join the array to recover the headword for display.
- `edges[i]` is a map (keyed by stringified integer edit-distance) of
  this node's children, where each value is the child node's index into
  `nodes` (and `edges`).
- `root` is the index of the root node (always `0` for non-empty trees),
  or `null` when the tree is empty.

To re-hydrate:

1. Create an array of node objects, one per `nodes[i]`.
2. Walk `edges[i]` and link `nodes[i]` to its children by index.
3. Query: standard BK-tree range search; the distance function is
   character-level Levenshtein for the English tree and Levenshtein over
   syllable sequences for the Burmese tree.

Query thresholds live in `config.py`:
`FUZZY_THRESHOLD_EN = 1`, `FUZZY_THRESHOLD_MY = 1` (spec §2.5). They are
not baked into the tree.

### How to obtain the EngMyanDictionary input

The dictionary source is the
`chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary`
HuggingFace dataset. The full dataset is ~950 MB because it ships two
PNG-blob columns (`image_definition`, `picture`) the app does not use;
the helper script below downloads **only the text columns** the pipeline
consumes (`word`, `stripword`, `title`, `definition`, `raw_definition`,
`keywords`, `synonym`) and writes them as JSONL at the path the
pipeline reads by default.

```bash
# One-time install of the downloader's optional dependencies.
# (`download` is an extra defined in tools/data-pipeline/pyproject.toml.)
pip install -e "tools/data-pipeline[download]"

# Fetches the text-only columns into data/engmyan/engmyan.jsonl (git-ignored).
python tools/data-pipeline/scripts/download_engmyan.py
```

The script projects parquet shards down to the text columns at read
time so the image bytes never materialize on disk in your tree. The
`data/engmyan/` directory is git-ignored. If the JSONL is missing when
`engmyan` (or `all`) runs, the CLI exits 1 with an actionable
instruction — no stack trace.

**License caveat (important).** EngMyanDictionary is GPL-2.0 (inherited
from the upstream Android app
[`soeminnminn/EngMyanDictionary`](https://github.com/soeminnminn/EngMyanDictionary)).
The shipped `dictionary.sqlite` is therefore a derived work under
GPL-2.0. Redistributions must comply. The in-app Settings view surfaces
the attribution (`EngMyanDictionary by Soe Minn Minn, via the
chuuhtetnaing HuggingFace dataset, GPL-2.0`). The previous data source
(kaikki / Wiktionary, CC-BY-SA) is no longer the default; see spec §3.1.

### `convert-ngram` input — the myWord pickles

The `convert-ngram` step reads the **merged** word-level n-gram pickles
that ship with the [myWord](https://github.com/ye-kyaw-thu/myWord)
segmenter and converts them into `ngram.json` (above) for the JS Viterbi
word segmenter (spec §4.2). The conversion is **faithful** — every
unigram and bigram with its raw count is preserved. **No pruning,
thresholding, or downsampling is performed.** A pruning pass may follow
as a separate task informed by the sizes the `report` step emits.

#### Files required

| File | Source | Place at |
|---|---|---|
| `unigram-word.bin` | myWord `dict_ver1/` (after running `combine-all-splitted-files.sh`) | `data/myword/unigram-word.bin` |
| `bigram-word.bin`  | myWord `dict_ver1/` (after running `combine-all-splitted-files.sh`) | `data/myword/bigram-word.bin` |

To set up:

```bash
# Clone myWord and assemble the merged binaries (their bigrams are split
# across many sub-files due to GitHub's 50 MB upload limit).
git clone https://github.com/ye-kyaw-thu/myWord.git
cd myWord/dict_ver1
bash ./combine-all-splitted-files.sh

# From the myangler-web repo root, copy or symlink them into place.
mkdir -p data/myword
ln -s "$(pwd)/unigram-word.bin" data/myword/unigram-word.bin
ln -s "$(pwd)/bigram-word.bin"  data/myword/bigram-word.bin
```

`data/*` is git-ignored (see the repo `.gitignore`) so the pickles are
not committed. If they are missing the step exits 1 with an actionable
error pointing at the missing file — no stack trace.

The phrase-level pickles myWord also ships (`unigram-phrase.bin`,
`bigram-phrase.bin`) are intentionally **not** consumed: spec §2.2 / §4.2
only port the *word* Viterbi segmenter, and the phrase data would
roughly quadruple the precache payload for a feature the app does not
expose.

#### Verified pickle structure (myWord `dict_ver1` v1)

| File | Pickle type | Key | Value | Entry count |
|---|---|---|---|---|
| `unigram-word.bin` | `collections.defaultdict(int)` | `str` (Burmese word) | `int` (raw count) | 124,676 |
| `bigram-word.bin`  | `collections.defaultdict(int)` | `tuple[str, str]` (`(prev, curr)`) | `int` (raw count) | 1,155,739 |

Notes on the upstream code:

- The myWord `ProbDist` uses a **hardcoded denominator** `N = 102490` to
  turn raw counts into probabilities. That constant is a code-level
  detail of the original Python segmenter — `convert-ngram` preserves
  raw counts plus the actual unigram/bigram totals so the JS port can
  apply whatever normalization it wants (ML estimate, smoothing, the
  legacy constant, etc.) without losing information.
- Upstream `myWord/word_segment.py` looked up bigrams by
  `f"{prev} {curr}"` *strings* even though the pickle is keyed by
  `(prev, curr)` *tuples*. That mismatch meant every bigram lookup
  raised `KeyError` in upstream and the segmenter silently fell back to
  unigram-only scoring. Both the JS port and the vendored Python
  reference at [`reference/myword/word_segment.py`](reference/myword/word_segment.py)
  fix this by looking up the tuple key (`bigram[prev][curr]`) that
  actually exists in the pickle and in `ngram.json`.

#### Trusted-input note

Python's `pickle` can execute arbitrary code on `load`. The myWord
upstream is treated as trusted, but `convert-ngram` still loads via a
restricted unpickler (`_SafeUnpickler`) that only permits the small
class set the legitimate myWord dictionaries use
(`collections.defaultdict`, `dict`, `int`, `str`, `tuple`, `list`).
**Do not** redirect this step at user-supplied or otherwise untrusted
pickle paths; the safer fallback is to refuse to convert anything from
an unknown source.

### Output: `ngram.json` (frontend contract)

UTF-8 JSON, single object. The shape is fixed — the JS Viterbi
segmenter port consumes these field names directly.

```jsonc
{
  "format": "myword-ngram/v1",
  "source": {
    "unigram": "unigram-word.bin",
    "bigram":  "bigram-word.bin"
  },
  "unigram_count": 124676,         // distinct unigrams
  "unigram_total": 12345678,       // sum of all unigram counts
  "bigram_count":  1155739,        // distinct (prev, curr) pairs
  "bigram_total":  9876543,        // sum of all bigram counts
  "unigram": {
    "က":   5,
    "သွား": 7,
    /* ... */
  },
  "bigram": {
    "က":   { "ခ": 2, "သွား": 1 },
    "သွား": { "မြန်မာ": 4 }
    /* ... */
  }
}
```

- `unigram` is a flat `{word: count}` map.
- `bigram` is a **2-level nested** `{prev: {curr: count}}` map. The
  pickle's `(prev, curr)` tuple keys are grouped by `prev` so they
  round-trip cleanly through JSON without inventing a key separator,
  and so the JS port can look them up directly via
  `bigram.get(prev)?.get(curr)` (O(1) per Viterbi step).
- `unigram_total` / `bigram_total` are sums of the values in `unigram` /
  `bigram` respectively. They are convenience metadata so the JS
  segmenter doesn't have to walk the maps to compute them at startup;
  the frontend may also recompute them and verify.
- The asset is shipped **uncompressed**. Compression (gzip / brotli) at
  the service-worker / hosting layer is a frontend concern; the `report`
  step prints the gzipped size for budgeting purposes only.

### Version stamp

`version.json` looks like:

```json
{"version": "20260515T030000Z", "scheme": "utc-timestamp/v1"}
```

The `version` string is a UTC build timestamp in
`YYYYMMDDTHHMMSSZ` form (sortable, opaque to the service worker — the
service worker compares it for equality only, not semantic ordering). The
`scheme` field is the format identifier so future changes are
distinguishable. Asset size: tens of bytes.

## Pipeline order

`all` runs:

1. `engmyan`   — ingest EngMyanDictionary rows and **invert** them into
   Burmese-keyed `StrippedEntry` records (spec §3.1, §6.2). Replaces the
   legacy kaikki `strip` step as the dictionary-source loader.
2. `index-en`  — build the English inverted index
3. `merge-g2p` — *skipped* (stub)
4. `build-db`  — build, index, and VACUUM the SQLite database (a hard
   size ceiling fails the build if it exceeds `MAX_DB_SIZE_BYTES`, spec
   §3.1.1 — the bundle safety net against image-column regressions)
5. `convert-ngram` — convert myWord pickled n-grams into `ngram.json`
6. `bktree-en` — build the English BK-tree
7. `bktree-my` — build the Burmese BK-tree
8. `version`   — emit the version stamp
9. `report`    — print entry counts and on-disk asset sizes (incl.
   the n-gram payload and per-asset gzipped sizes for budgeting)

Mirrors spec §6 steps 2–10. Each step lives in its own module under
`src/data_pipeline/steps/`.

The legacy `strip` step (kaikki Wiktionary loader) is preserved as a
standalone subcommand for back-compat and regression testing; it is no
longer wired into `all`.

## Project layout

```
tools/data-pipeline/
├── pyproject.toml
├── .python-version
├── README.md
├── src/data_pipeline/
│   ├── __init__.py
│   ├── __main__.py        # python -m data_pipeline
│   ├── cli.py             # argparse entry point + step dispatch
│   ├── config.py          # paths, stopwords, thresholds, version scheme
│   ├── io.py              # streaming JSONL reader + output helpers
│   ├── bktree.py          # generic BK-tree (distance function injected)
│   ├── syllable.py        # sylbreak-style Burmese syllable segmenter
│   └── steps/
│       ├── __init__.py
│       ├── engmyan.py     # EngMyanDictionary ingestion + Burmese-keyed inversion
│       ├── strip.py       # legacy kaikki loader (back-compat)
│       ├── index_en.py    # English inverted index + tier flags
│       ├── build_db.py    # SQLite assembly + VACUUM
│       ├── bktree_en.py   # English BK-tree build & serialize
│       ├── bktree_my.py   # Burmese BK-tree build & serialize
│       ├── convert_ngram.py # myWord pickle → ngram.json
│       ├── version.py     # version-stamp generation
│       └── report.py      # final report formatter
├── scripts/
│   └── download_engmyan.py  # one-shot HF text-only downloader
└── tests/
    ├── test_smoke.py
    ├── test_engmyan.py
    ├── test_strip.py
    ├── test_index_en.py
    ├── test_syllable.py
    ├── test_bktree.py
    ├── test_build_db.py
    ├── test_convert_ngram.py
    └── test_all_pipeline.py
```

Paths in `config.py` resolve against the repository root (located by
walking up to the first `.git` directory), so the CLI works regardless
of the directory it is invoked from.

## Tests

```bash
# From the repo root, with the venv active:
pytest tools/data-pipeline
```

The test suite is fully fixture-based — it does **not** depend on the
real `data/dictionary-burmese.jsonl` and runs in well under a second. It
covers:

- field extraction, gloss joining, gloss normalization (`"to "` stripping,
  the empty-gloss case);
- inverted-index construction, stopword exclusion, exact/head/incidental
  tier flags;
- the syllable segmenter on known Burmese inputs (Myanmar, stacked
  consonants, digits, mixed script);
- BK-tree insertion + threshold query at both character and syllable
  levels;
- SQLite build (expected tables/indexes; forward lookup; reverse lookup
  with tier ordering; merging via `gloss_groups`);
- end-to-end `all` on a tiny fixture (every asset produced, version
  stamp well-formed);
- `convert-ngram` against a synthetic pickle fixture mimicking the real
  myWord shape: missing-input error, faithful-conversion check,
  whitelist-unpickler safety check, deterministic round-trip.

## What's intentionally not here yet

- `merge-g2p` (the myG2P headword merge — coverage extension)
- A pruning pass for the n-gram asset (a separate task, to be sized
  against the numbers `report` prints)
- The myWord **word** segmenter port itself (lives on the frontend
  under `app/lib/segmenter/`; the vendored reference under
  `reference/myword/` is its ground truth, not part of the pipeline)

Built output under `build/` is git-ignored.
