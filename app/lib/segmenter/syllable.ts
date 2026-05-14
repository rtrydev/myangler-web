// Burmese syllable segmenter — TypeScript port of
// `tools/data-pipeline/src/data_pipeline/syllable.py`.
//
// Behavior must match the Python reference exactly: the Burmese fuzzy-search
// BK-tree is built with the Python segmenter, so any divergence means
// the segmenter and the BK-tree disagree about syllable boundaries and
// fuzzy lookups silently miss (Task 04, Requirement 2).

const ASAT = 0x103a;
const VIRAMA = 0x1039;

function isConsonant(cp: number): boolean {
  return cp >= 0x1000 && cp <= 0x1021;
}

function isBurmeseAttached(cp: number): boolean {
  return (
    (cp >= 0x102b && cp <= 0x103e) ||
    (cp >= 0x1056 && cp <= 0x1059) ||
    (cp >= 0x105e && cp <= 0x1060) ||
    (cp >= 0x1062 && cp <= 0x1064) ||
    (cp >= 0x1067 && cp <= 0x106d) ||
    (cp >= 0x1071 && cp <= 0x1074) ||
    (cp >= 0x1082 && cp <= 0x108d) ||
    cp === 0x108f ||
    (cp >= 0x109a && cp <= 0x109d)
  );
}

function isBurmeseInitial(cp: number): boolean {
  if (cp >= 0x1000 && cp <= 0x1021) return true;
  if (cp >= 0x1023 && cp <= 0x102a) return true;
  if (cp >= 0x1040 && cp <= 0x104f) return true;
  if (cp >= 0x1050 && cp <= 0x1055) return true;
  if (cp >= 0x105a && cp <= 0x105d) return true;
  if (cp === 0x1061 || (cp >= 0x1065 && cp <= 0x1066)) return true;
  if (cp >= 0x106e && cp <= 0x1070) return true;
  if (cp >= 0x1075 && cp <= 0x1081) return true;
  if (cp === 0x108e) return true;
  if (cp >= 0x1090 && cp <= 0x1099) return true;
  if (cp >= 0x109e && cp <= 0x109f) return true;
  return false;
}

// Returns the list of Burmese syllable clusters in `text`, mirroring
// `data_pipeline.syllable.segment_syllables`. Iterates over Unicode code
// points (not UTF-16 code units) so surrogate-pair characters are not
// split. Empty input returns [].
export function segmentSyllables(text: string): string[] {
  if (text.length === 0) return [];

  // Materialize the string as code points so indexing matches Python's
  // codepoint-indexed `text[i]`. All Burmese codepoints are in the BMP
  // so this is mostly defensive against stray non-BMP chars.
  const cps: number[] = Array.from(text, (ch) => ch.codePointAt(0)!);
  const n = cps.length;

  const breaks: number[] = [0];
  for (let i = 1; i < n; i++) {
    const cp = cps[i];
    if (isConsonant(cp)) {
      // Stacking: virama immediately before this consonant attaches it
      // to the previous syllable.
      if (cps[i - 1] === VIRAMA) continue;
      // Final-consonant closer: consonant + asat closes the previous
      // syllable, so do not break before it.
      if (i + 1 < n && cps[i + 1] === ASAT) continue;
      breaks.push(i);
    } else if (isBurmeseInitial(cp)) {
      breaks.push(i);
    } else if (isBurmeseAttached(cp)) {
      continue;
    } else {
      // Non-Burmese codepoint — emit it on its own so foreign chars
      // never collapse into a Burmese cluster.
      breaks.push(i);
      if (i + 1 < n) breaks.push(i + 1);
    }
  }
  breaks.push(n);

  const out: string[] = [];
  for (let k = 0; k < breaks.length - 1; k++) {
    const a = breaks[k];
    const b = breaks[k + 1];
    if (a < b) {
      out.push(String.fromCodePoint(...cps.slice(a, b)));
    }
  }
  return out;
}
