# data-pipeline

Build-time tool that turns the raw kaikki.org Burmese Wiktionary extract
into the static assets shipped by the **myangler-web** PWA frontend
(SQLite database, BK-trees, version stamp).

It is a separate, auxiliary tool — it runs at build time on a developer
machine, reads from the repo's `data/` directory, and writes everything
into its own `build/` directory. The frontend app is not touched.

The authoritative description of what this pipeline must produce lives
in [`docs/burmese-dictionary-spec.md`](../../docs/burmese-dictionary-spec.md) —
in particular **§3 (Data)** and **§6 (Build Pipeline)**.

## Status

| Step | Status | Notes |
|---|---|---|
| `load` | implemented | Streams & validates the JSONL extract |
| `strip` | implemented | Extracts headword/POS/glosses/IPA; normalizes glosses (spec §2.4.1) |
| `index-en` | implemented | English inverted index w/ exact/head/incidental tier flags |
| `merge-g2p` | **stub** | Out of scope for v1; v1 ships on Wiktionary data only |
| `build-db` | implemented | SQLite DB w/ indexes, VACUUMed |
| `convert-ngram` | **stub** | Out of scope for v1 |
| `bktree-en` | implemented | Char-level Levenshtein over gloss-words |
| `bktree-my` | implemented | Syllable-level Levenshtein over headwords |
| `version` | implemented | UTC build-timestamp stamp |
| `report` | implemented | Prints entry counts and asset sizes |
| `all` | implemented | Runs every implemented step in order |

v1 ships on Wiktionary data alone. `merge-g2p` and `convert-ngram` remain
logging-only stubs and are skipped by `all` — they are owned by later
tasks. The myWord **word** segmenter is also out of scope here; only the
build-time **syllable** segmenter (`data_pipeline.syllable`, used by the
Burmese BK-tree) is implemented.

## Requirements

- Python **3.13** (pinned in `.python-version`; `>=3.11` works in practice
  and is what `pyproject.toml` declares).
- The raw Burmese JSONL extract at `data/dictionary-burmese.jsonl`
  (already committed to the repo).

No third-party runtime dependencies — the implementation uses only the
Python standard library (including the bundled `sqlite3`). Dev tools
(pytest, ruff) live in the `[dev]` extra.

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
data-pipeline strip        # standalone: just summarize the strip stage
data-pipeline index-en     # standalone: build & summarize the index
data-pipeline build-db     # standalone: build the SQLite DB only
data-pipeline bktree-en    # standalone: build the English BK-tree
data-pipeline bktree-my    # standalone: build the Burmese BK-tree
data-pipeline version      # standalone: emit just the version stamp
data-pipeline report       # equivalent to `all` (rebuilds + prints summary)
```

Global options:

- `--input PATH`       Path to the raw JSONL (default:
  `data/dictionary-burmese.jsonl`, resolved against the repo root).
- `--output-dir PATH`  Where built assets land (default:
  `tools/data-pipeline/build/`).
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

1. `strip`     — strip entries to required fields; normalize glosses
2. `index-en`  — build the English inverted index
3. `merge-g2p` — *skipped* (stub)
4. `build-db`  — build, index, and VACUUM the SQLite database
5. `convert-ngram` — *skipped* (stub)
6. `bktree-en` — build the English BK-tree
7. `bktree-my` — build the Burmese BK-tree
8. `version`   — emit the version stamp
9. `report`    — print entry counts and on-disk asset sizes

Mirrors spec §6 steps 2–10. Each step lives in its own module under
`src/data_pipeline/steps/`.

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
│       ├── strip.py       # field extraction + gloss normalization
│       ├── index_en.py    # English inverted index + tier flags
│       ├── build_db.py    # SQLite assembly + VACUUM
│       ├── bktree_en.py   # English BK-tree build & serialize
│       ├── bktree_my.py   # Burmese BK-tree build & serialize
│       ├── version.py     # version-stamp generation
│       └── report.py      # final report formatter
└── tests/
    ├── test_smoke.py
    ├── test_strip.py
    ├── test_index_en.py
    ├── test_syllable.py
    ├── test_bktree.py
    ├── test_build_db.py
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
  stamp well-formed).

## What's intentionally not here yet

- `merge-g2p` (the myG2P headword merge — coverage extension)
- `convert-ngram` (the myWord n-gram conversion — needed for the word
  segmenter)
- The myWord **word** segmenter port itself (lives on the frontend)

Built output under `build/` is git-ignored.
