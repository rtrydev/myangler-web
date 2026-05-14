# data-pipeline

Build-time tool that turns the raw kaikki.org Burmese Wiktionary extract
into the static assets shipped by the **myangler-web** PWA frontend
(SQLite database, n-gram dictionaries, BK-trees, version stamp).

It is a separate, auxiliary tool — it runs at build time on a developer
machine, reads from the repo's `data/` directory, and writes everything
into its own `build/` directory. The frontend app is not touched.

The authoritative description of what this pipeline must produce lives
in [`docs/burmese-dictionary-spec.md`](../../docs/burmese-dictionary-spec.md) —
in particular **§3 (Data)** and **§6 (Build Pipeline)**.

> **Status: scaffold.** Only the `load` subcommand does real work. Every
> other pipeline step is a logging-only stub that will be filled in by
> subsequent tasks.

## Requirements

- Python **3.13** (pinned in `.python-version`; `>=3.11` works in
  practice and is what `pyproject.toml` declares).
- The raw Burmese JSONL extract at `data/dictionary-burmese.jsonl`
  (already committed to the repo).

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

The CLI exposes one subcommand per pipeline step from spec §6, plus an
`all` command that will eventually run them in order:

```bash
data-pipeline --help
data-pipeline load        # working: streams the JSONL and reports counts
data-pipeline strip       # stub
data-pipeline index-en    # stub
# ...
data-pipeline all         # stub: walks every step in order
```

Global options:

- `--input PATH`       Path to the raw JSONL (default:
  `data/dictionary-burmese.jsonl`, resolved against the repo root).
- `--output-dir PATH`  Where built assets land (default:
  `tools/data-pipeline/build/`).
- `-v` / `-vv`         Increase logging verbosity (info / debug).

### The one functional command: `load`

`load` streams the entire JSONL input, tolerates malformed lines, and
prints a summary:

```bash
$ data-pipeline load
parsed:  41827
skipped: 0
```

Use this to sanity-check the downloaded data and the input plumbing.

## Pipeline order

`all` will eventually run these in order (mirrors spec §6):

1. `load`           — load & validate the raw JSONL (working)
2. `strip`          — strip entries to required fields; join glosses
3. `index-en`       — build the English inverted index
4. `merge-g2p`      — optionally merge the myG2P headword list
5. `build-db`       — build, index, and VACUUM the SQLite database
6. `convert-ngram`  — convert myWord n-gram dicts to a JS-loadable form
7. `bktree-en`      — build the English BK-tree
8. `bktree-my`      — build the Burmese BK-tree
9. `version`        — emit the version stamp
10. `report`        — report final entry count and asset sizes

Each step lands in its own module under
`src/data_pipeline/steps/` as it is implemented.

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
│   ├── config.py          # paths, thresholds, version-stamp format
│   ├── io.py              # streaming JSONL reader + output helpers
│   └── steps/             # one module per pipeline step (filled in later)
└── tests/
    └── test_smoke.py
```

Paths in `config.py` resolve against the repository root (located by
walking up to the first `.git` directory), so the CLI works regardless
of the directory it is invoked from.

## Tests

```bash
# From the repo root, with the venv active:
pytest tools/data-pipeline
```

The smoke suite covers package import, CLI `--help`, the JSONL reader
(including malformed-line tolerance), and stub-subcommand exit
behavior. It uses an inline fixture, so it does not depend on the real
`data/dictionary-burmese.jsonl` and runs in well under a second.

## What's intentionally not here yet

Per the scaffold scope, this tool does **not** install heavy language-
processing libraries (Burmese segmentation, myWord, IPA tooling). Those
will be added by the tasks that implement the steps that need them.

Built output under `build/` is git-ignored.
