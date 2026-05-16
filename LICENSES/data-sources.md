# Data-source licenses

This file documents the licenses of every data asset bundled into the
shipped myangler-web PWA. The source code in this repository is
otherwise governed by its own project licenses; this file covers only
the **data**.

## `public/data/dictionary.sqlite`

Derived from the **EngMyanDictionary** dataset by Soe Minn Minn,
redistributed as the
[`chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary`](https://huggingface.co/datasets/chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary)
HuggingFace dataset. The upstream source is
[`soeminnminn/EngMyanDictionary`](https://github.com/soeminnminn/EngMyanDictionary).

**License: [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).**

The build pipeline (`tools/data-pipeline/`) ingests the dataset's text
columns only — the dataset's two PNG-blob columns (`image_definition`,
`picture`, ~950 MB combined) are explicitly excluded; the shipped
`dictionary.sqlite` contains no image data.

The pipeline's `engmyan` step parses each English-keyed row's HTML /
raw-text Myanmar definition into discrete Burmese terms, merges them
across rows, and writes a SQLite database keyed on Burmese headwords
whose glosses are the original English `word`s plus synonyms. The
resulting database is therefore a **derived work** of the
GPL-2.0-licensed EngMyanDictionary and is distributed under the same
license.

Attribution is surfaced in-app via the Settings view ("Data sources"
section).

### Previous source

Versions of this project prior to the v1 data-source migration shipped
a derived work of the Burmese English Wiktionary extract via
[kaikki.org](https://kaikki.org/), licensed
[CC-BY-SA](https://creativecommons.org/licenses/by-sa/3.0/). That
extract is no longer shipped. The legacy `strip` pipeline step is kept
as a back-compat regression-test target only; it is no longer part of
the default build chain.

## `public/data/ngram.json`

N-gram statistics derived from the [myWord](https://github.com/ye-kyaw-thu/myWord)
Burmese word segmenter by Ye Kyaw Thu. The pipeline's `convert-ngram`
step performs a faithful conversion of the upstream pickled unigram +
bigram tables; counts and totals are preserved.

myWord is licensed
[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html).

## `public/data/bktree-en.json`, `public/data/bktree-my.json`

Both BK-tree assets are computed directly from `dictionary.sqlite`
(gloss-words and Burmese headwords respectively) and therefore inherit
its license (GPL-2.0).

## `public/data/version.json`

Synthetic UTC build-timestamp; no third-party content.
