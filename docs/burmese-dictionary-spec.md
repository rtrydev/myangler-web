# Burmese Dictionary PWA — Specification

## 1. Overview

A bidirectional Burmese ↔ English dictionary application delivered as a
Progressive Web App. The user inputs Burmese or English text; the app segments
Burmese input into words, looks each word up, and presents results. English
input is routed to a reverse lookup. The entire experience — segmentation,
lookup, fuzzy search, history, favorites — runs **client-side with no
backend**. After the user installs the PWA (via Safari or Chrome "Add to Home
Screen"), the app works fully offline.

### 1.1 Core principles

- **Backend-free.** All logic and data ship as static assets.
- **Offline-first.** A service worker precaches everything on first load.
- **Lookup-driven.** Search and segmentation are built around what actually
  exists in the dictionary.
- **User-visible segmentation.** Word segmentation is a first-class,
  interactive UI element, not hidden plumbing.

---

## 2. Functional Requirements

### 2.1 Input handling

- A single input box accepts **any** text the user provides: a single word, a
  sentence, or multiple sentences.
- Maximum input length is approximately **500 characters**. The exact ceiling
  is to be derived from performance benchmarking (Viterbi segmentation +
  eager lookup on a mobile device); 500 is the working figure until measured.
- **Script detection** runs on input to decide routing:
  - Burmese (Myanmar Unicode range) → segmentation path.
  - English (Latin) → reverse lookup path.
- Multi-sentence input is treated as **one continuous segmentation pass**.
  No sentence-boundary splitting is performed; the resulting block sequence
  simply grows longer. (No `mySentence`-style component is in scope.)
- Zawgyi encoding is **out of scope** for this version. Input is assumed to be
  Unicode. (Detection/conversion may be revisited later.)

### 2.2 Word segmentation (Burmese input)

- Burmese input is segmented into words using a **port of the myWord
  segmenter** (see Section 4).
- Segmentation output is rendered as an **interactive sequence of token
  blocks**.
- Each block is **looked up eagerly** (immediately upon segmentation) so it can
  display a short gloss preview at rest.
- Tapping a block opens a **modal** showing the full dictionary entry for that
  token.
- There is **no recourse for disputed segmentation**. If the user disagrees
  with a split, the intended workflow is to query the word individually via
  the single-word path. The token sequence model therefore does not support
  merge/split editing.
- On a lookup **miss** for a token, behavior to be finalized during
  implementation; the fallback option of offering syllable-level pieces is
  noted but not committed.

### 2.3 Word lookup (Burmese → English)

- Each segmented token is looked up against the Burmese headword index.
- Results show the English glosses for the entry.
- Glosses are typically short English counterparts (a list), not long
  lexicographic definitions — the pipeline's inversion step (§6.2) extracts
  the dataset's English headword + synonyms as the gloss list and drops
  the Burmese-side example sentences.

### 2.4 Reverse lookup (English → Burmese)

English input is matched against an inverted index built from the English
glosses of Burmese entries. Results are produced via a **tiered ranking
algorithm**.

#### 2.4.1 Ranking tiers

Results are drawn from ordered tiers, filling a **top-10** list from the
highest tier down:

1. **Exact match** — the query equals a full gloss after normalization
   (lowercase, trim, strip leading `"to "`).
2. **Word-in-gloss match** — the query appears as a whole word within a longer
   gloss (e.g. `"go"` inside `"to go up"`). May optionally be sub-ranked by
   position in gloss or gloss length; this sub-ranking is a refinement, not
   required for v1.
3. **Fuzzy match** — the query is a near-miss of a gloss or gloss-word within
   the configured edit-distance threshold.

#### 2.4.2 Fuzzy inclusion policy

- Fuzzy results are **always included** at low priority — they are never
  suppressed by the presence of exact or substring matches.
- Fuzzy results **never preempt** a real (exact or substring) match; they only
  occupy remaining slots in the top-10.
- Rationale: suppressing fuzzy results when an exact match exists would hide
  the typo-recovery path exactly when the query is most broken (e.g. a typo
  that coincidentally exact-matches an unrelated word).

#### 2.4.3 Result merging

- Wherever multiple entries share an **identical normalized gloss**, they are
  **merged into a single result row** listing all the corresponding Burmese
  words.
- This merging applies in **any tier**, not only the exact-match tier.

#### 2.4.4 Refinement model

- Only the top-10 are shown. If the result the user wants is not present, the
  expected behavior is for the user to enter a **more specific query**. There
  is no pagination or "show more".

### 2.5 Fuzzy search (both directions)

Fuzzy matching is supported for **both** English and Burmese input.

- **English fuzzy:** character-level edit distance over **gloss-words**.
- **Burmese fuzzy:** **syllable-level** edit distance over **headwords**.
  - Burmese fuzzy must operate on **syllable clusters**, not raw Unicode
    codepoints. A Burmese syllable is a multi-codepoint cluster (consonant +
    medials + vowel signs + tone marks + `asat`); raw-codepoint edit distance
    both misses obvious typos and matches unrelated words.
  - The app's **syllable segmenter** (the ported `sylbreak` regex, see
    Section 4.1) is reused as the tokenizer: the query and headwords are
    segmented into syllables, and edit distance is computed over the syllable
    sequences.
- **Threshold:** edit distance **1**, exposed as an **adjustable configuration
  constant**. The threshold may be tuned **independently per direction**,
  since one syllable-edit and one character-edit are not equivalent in
  strictness.
- Fuzzy matching runs against **gloss-words** (English) consistent with the
  tokenization used by the word-in-gloss tier.

### 2.6 Search execution model

- Search is **debounced** — the query runs a configurable interval after the
  last keystroke (starting value ~200–300 ms, tunable).
- Debouncing provides live-search responsiveness without querying on every
  keystroke and keeps lookup performance comfortably within budget.

### 2.7 Results display

- **Burmese input:** interactive block sequence; each block shows a gloss
  preview at rest; tap → modal with full entry.
- **English input:** ranked top-10 results list; selecting a result → modal
  with full entry.
- The **definition modal** is the shared surface for showing a full entry,
  reached from either path.

### 2.8 History

- Looked-up sentences/words are saved to **local persistence** (IndexedDB).
- Survives app restarts and works offline.

### 2.9 Favorites

- The user can save words/entries as favorites.
- Stored in **local persistence** (IndexedDB).

> **Prototyping note:** Browser storage (localStorage/IndexedDB) does not
> function inside a Claude artifact environment. History and favorites
> therefore cannot be tested in-artifact; they require a real deployment or
> local dev environment. This does not affect the production app.

---

## 3. Data

### 3.1 Dictionary source

- **Primary source:** the **EngMyanDictionary** dataset by Soe Minn Minn,
  redistributed as the
  `chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary`
  HuggingFace dataset. Originally an Android learner's dictionary
  (Oxford-style) keyed on English headwords.
- Format on HuggingFace: parquet shards (one row per English headword)
  with text columns (`word`, `stripword`, `title`, `definition`,
  `raw_definition`, `keywords`, `synonym`) plus two PNG-blob columns
  (`image_definition`, `picture`). The build pipeline **ignores the image
  columns**; only the text columns are downloaded and processed (the full
  dataset including images is ~950 MB — they would never fit the offline
  PWA budget).
- **Direction inversion (load-bearing design):** the dataset is
  English-keyed but the app — every query path, every lookup table,
  every BK-tree, the segmenter integration — is **Burmese-keyed**. The
  pipeline's `engmyan` step (§6) reads each English row, extracts the
  Burmese glosses out of its HTML/raw definition, and emits one
  **Burmese-headword** entry per distinct Burmese term, with the English
  word (plus synonyms) as its short English counterparts. After this
  inversion the in-memory shape matches the legacy kaikki shape exactly,
  so every downstream pipeline stage and the entire frontend continue to
  work without code changes.
- **License:** **GPL-2.0** (inherited from
  `soeminnminn/EngMyanDictionary`). Attribution to "EngMyanDictionary by
  Soe Minn Minn, via the chuuhtetnaing HuggingFace dataset, GPL-2.0" is
  surfaced through the Settings view. The shipped `dictionary.sqlite` is
  a derived work under GPL-2.0; redistributions must comply. This is a
  **change from v0**, which shipped CC-BY-SA Wiktionary data — the
  earlier kaikki extract is no longer the source.

#### 3.1.1 Bundle safety net

Because the dataset carries large image columns, the build's `report`
step enforces a hard ceiling on `dictionary.sqlite`
(`config.MAX_DB_SIZE_BYTES`, currently 80 MiB) and fails the build if
exceeded. The text-only inverted DB lands around ~40 MB at the current
dataset rev; the ceiling sits well above that to absorb legitimate
coverage growth while still catching an image-column regression
(which would push the DB into the hundreds of MB).

### 3.2 Recommended coverage extension

- The **myG2P** Burmese grapheme-to-phoneme dictionary may be merged in
  as a **headword list** for coverage extension. EngMyanDictionary's
  Burmese-side coverage is materially wider than the legacy kaikki
  extract (more distinct Burmese terms after inversion), so myG2P is
  less load-bearing than it was, but it still helps **align the
  segmenter's vocabulary with the dictionary** so the splits the
  segmenter produces are more likely to be looked up successfully (the
  mitigation called out in §4.3).
- myG2P provides **no English translations** and is not a definition source.
  Merged headwords that have no EngMyan gloss are surfaced as
  headword-only entries (i.e. the app can confirm the word exists, but has
  no English meaning to show).
- The merge remains technically optional in the pipeline (the `merge-g2p`
  step is a stub today; revisit if real-world miss rates motivate it).

### 3.3 Shipped data assets

The build pipeline produces the following static assets:

| Asset | Purpose |
|---|---|
| SQLite database | Headword → glosses; English inverted index; entry data |
| myWord n-gram dictionaries | Unigram + bigram data for the Viterbi segmenter |
| English BK-tree | Character-level fuzzy search over gloss-words |
| Burmese BK-tree | Syllable-level fuzzy search over headwords |
| Version stamp | Embedded version identifier for cache invalidation |

### 3.4 SQLite database

- Stripped to the fields the app actually uses: **headword, part of speech,
  joined glosses** (optionally IPA pronunciation).
- Includes the **English inverted index**: for each Burmese entry, every
  meaningful English gloss-word points back to it.
  - Stopwords (`a`, `the`, `of`, …) are excluded from the inverted index.
  - Leading `"to "` is stripped from verb glosses before indexing so `"to go"`
    and `"go"` align.
  - Index build favors entries where the query word is the **whole gloss** or
    the **head** of the gloss over entries where it is incidental.
- **Indexed** on the headword column for fast lookup. The English inverted
  index is indexed for reverse lookup. No unnecessary secondary indexes.
- **VACUUM**ed after build to reclaim free pages.
- **Estimated size:** the EngMyanDictionary-derived database carries
  more entries than the legacy kaikki source (the dataset has tens of
  thousands of English rows; after inversion + merging the distinct
  Burmese-headword count rises in proportion to how many English senses
  share each term). Even so the shipped DB stays in the low single-digit
  MB range — text payload only, never images. The build's `report` step
  prints the actual size, and a hard ceiling (`MAX_DB_SIZE_BYTES`,
  §3.1.1) fails the build if a regression bloats it past 15 MiB. The
  n-gram data (§4.2.3) remains the dominant first-load concern.

### 3.5 Client-side database access

- On web/PWA, the SQLite file is loaded and queried in-browser via **`sql.js`**
  (SQLite compiled to WebAssembly). No server is involved.
- The DB file is loaded into memory; at ~1–2 MB this is comfortable on
  desktop and modern phones. First lookup is gated on the file download
  completing — negligible at this size relative to the n-gram payload.

---

## 4. Segmentation

### 4.1 Syllable segmentation

- Burmese syllable segmentation uses a **regex** approach (the `sylbreak`
  method): Unicode character classes for Burmese consonants, `asat`, stacking
  sign, etc.
- **Port effort:** low — essentially translating the character-class syntax to
  JavaScript. No algorithmic logic.
- Reused in two places: (a) optional syllable-level display, (b) the tokenizer
  for Burmese fuzzy search (Section 2.5).

### 4.2 Word segmentation — myWord Viterbi port (corrected)

- Word segmentation is a **port of the myWord segmenter** to JavaScript,
  verified against a **corrected, vendored** Python reference at
  `tools/data-pipeline/reference/myword/word_segment.py`. The port
  performs **true unigram+bigram Viterbi**: every step consults
  `P_bigram[(prev, curr)]` with a unigram backoff when the pair is
  missing.
- Upstream myWord shipped with a latent bug where bigram lookups used
  string keys against a tuple-keyed pickle, leaving bigrams loaded but
  never consulted; the vendored reference and the JS port both correct
  this (see `tools/data-pipeline/reference/README.md`).
- The port has three parts:
  1. **Viterbi logic** — a dynamic-programming routine (~50–100 lines of JS).
  2. **N-gram dictionary loading** — myWord ships these as pickled Python
     binaries, which JavaScript cannot read. They are **converted once**
     (in Python, at build time) by `data-pipeline convert-ngram` into a
     2-level nested JSON (`bigram[prev][curr]`) so the JS port can look
     bigrams up in O(1) per Viterbi step.
  3. **Asset size management** — the bigram dictionary is large (tens of
     MB). Combined with the SQLite DB, total precached payload could reach
     **30–50 MB+**. Because the PWA precaches everything on first load, this is
     a hard UX concern, not a footnote. Compression and/or pruning the n-gram
     data is expected to be necessary.

### 4.3 Segmenter ↔ dictionary vocabulary mismatch

- The myWord n-gram dictionaries were built from a **different corpus** than
  EngMyanDictionary. The segmenter can produce tokens that are not
  dictionary headwords, and miss splits that would have matched.
- This causes lookup misses that are **boundary disagreements**, not genuine
  "rare word" misses.
- Mitigations:
  - Merge the **myG2P headword list** (Section 3.2) to align vocabularies.
  - Define token-miss fallback behavior (Section 2.2) — e.g. retrying with
    stripped particles or adjacent-token combinations.

---

## 5. PWA & Offline Architecture

### 5.1 Service worker

- A service worker **precaches the full payload on first load**: app shell,
  myWord n-gram dictionaries, SQLite DB, both BK-trees.
- All assets must be **cacheable static files**.
- After install, the app must be **fully functional offline**.

### 5.2 Versioning & updates

- Dictionary/data updates are **manual** — the maintainer reships assets
  when desired (the upstream EngMyanDictionary dataset can change; there
  is no automatic update).
- A **version string is embedded** in the data assets and known to the service
  worker.
- The service worker uses the version stamp to **invalidate stale caches** and
  pull updated assets cleanly, avoiding a confusing half-updated state for
  already-installed users.
- The version hook is included from the start even though updates are
  infrequent — it is cheap to design in and prevents stale-cache bugs.

### 5.3 Local persistence

- **IndexedDB** is used for history and favorites (chosen over localStorage:
  structured, async, room to grow).
- Each of history and favorites has a small schema of its own.

---

## 6. Build Pipeline (requirements)

The build pipeline is a static-asset generator. It must:

1. Download the EngMyanDictionary HuggingFace dataset, **text columns
   only** (image columns are explicitly excluded — see §3.1).
2. **Ingest and invert** every dataset row: parse the HTML/raw-text
   Myanmar definition into discrete Burmese terms, NFC-normalize them,
   and emit one Burmese-headword entry per distinct term whose glosses
   are the English `word` (plus dataset synonyms). This step replaces
   the legacy kaikki `strip` step as the dictionary-source loader; the
   in-memory `StrippedEntry` shape is preserved so every downstream
   stage works unchanged.
3. Build the **English inverted index** with normalization, stopword removal,
   `"to "` stripping, and whole-gloss/head-of-gloss preference.
4. Merge the **myG2P headword list** for coverage and segmenter-vocabulary
   alignment (optional — see §3.2; remains a stub in this version).
5. Build the **SQLite database**, create the headword and inverted-index
   indexes, and **VACUUM**.
6. Convert the myWord **pickled n-gram dictionaries** to a JS-loadable format;
   compress/prune as needed for payload budget.
7. Build and serialize the **English BK-tree** (character-level over
   gloss-words).
8. Build and serialize the **Burmese BK-tree** (syllable-level over
   headwords) — this step requires the **syllable segmenter available at build
   time**.
9. Emit a **version stamp** embedded in the data assets.
10. Report the final **entry count** and **asset sizes**, and **fail the
    build if `dictionary.sqlite` exceeds the size ceiling** (§3.1.1).

---

## 7. Component Inventory

| Component | Type | Notes |
|---|---|---|
| Input box + script detection | UI / logic | Routes Burmese vs. English; ~500-char cap |
| Syllable segmenter | Logic | Ported `sylbreak` regex; reused by Burmese fuzzy |
| Word segmenter (Viterbi) | Logic | Ported myWord; loads n-gram dicts |
| Block sequence renderer | UI | Interactive, eager-lookup token blocks |
| Definition modal | UI | Shared full-entry surface for both paths |
| Burmese lookup | Logic | Headword index query via `sql.js` |
| Reverse lookup + tiered ranking | Logic | Inverted index; exact / word-in-gloss / fuzzy |
| English BK-tree | Data + logic | Char-level fuzzy |
| Burmese BK-tree | Data + logic | Syllable-level fuzzy |
| Debounced search controller | Logic | ~200–300 ms after last keystroke |
| History store | Persistence | IndexedDB |
| Favorites store | Persistence | IndexedDB |
| Service worker | Infra | Precache, offline, version-based invalidation |
| Build pipeline | Tooling | Produces all static data assets |

---

## 8. Open Items & To-Be-Benchmarked

- **Input length ceiling** — confirm the comfortable maximum for Viterbi +
  eager lookup on a mobile device; 500 chars is provisional.
- **Total precached payload size** — measure; if 30–50 MB+, decide on
  compression/pruning strategy for the n-gram data.
- **Reverse-lookup sub-ranking** — whether to sub-rank the word-in-gloss tier
  by position/length; tunable later against real data.
- **Fuzzy thresholds** — start at edit distance 1 per direction; tune
  independently as requirements emerge.
- **Debounce interval** — start ~200–300 ms; tune.
- **Token-miss fallback** — finalize behavior for Burmese tokens not found in
  the dictionary.
- ~~**kaikki Burmese entry count** — confirm from the source.~~ Superseded
  by the v1 migration to EngMyanDictionary (§3.1). kaikki is no longer
  the source; the relevant figure now is the count of **distinct Burmese
  headwords produced after inversion**, reported by `data-pipeline all`.

---

## 9. Explicitly Out of Scope (this version)

- Zawgyi encoding detection/conversion.
- Sentence-boundary splitting of multi-sentence input.
- User editing of segmentation (merge/split blocks).
- Pagination / "show more" beyond the top-10 reverse-lookup results.
- Automatic dictionary updates.
- Native mobile app (the target is a PWA).

