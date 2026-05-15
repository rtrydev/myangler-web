// Test fixture: builds the app's runtime dependencies (engine + cleared
// storage) and renders an arbitrary tree wrapped in the `EngineProvider`.
//
// The engine is built using the search-orchestrator fixture, which spins
// up a real sql.js DB + matching BK-trees. Tests therefore exercise the
// full data path — no engine mocks.

import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { SEARCH_FIXTURE } from "@/app/lib/search/__fixtures__/buildSearchEngine";
import type { SearchEngine } from "@/app/lib/search";
import type { FixtureEntry } from "@/app/lib/lookup/__fixtures__/buildFixture";
import { EngineProvider } from "../engine-context";
import { clearAllStorage } from "../storage";

/** Build a `SearchEngine` over an extended fixture. The default set
 *  covers the orchestrator's smoke fixtures plus a handful of extras
 *  the app's view tests need (compounds, English glosses, history
 *  examples). */
export const APP_FIXTURE: FixtureEntry[] = [
  ...SEARCH_FIXTURE,
  // ရေ now has glosses "water" + "liquid" so the entry-detail "Meanings"
  // list has more than one row to render.
  { entryId: 10, headword: "ရေ", pos: "noun", glosses: ["water", "liquid"] },
  // ရေချိုး — separate Burmese entry with English gloss "to bathe".
  { entryId: 11, headword: "ရေချိုး", pos: "verb", glosses: ["to bathe"] },
  // မြန်မာစာ — Burmese language (used in second sample sentence).
  {
    entryId: 12,
    headword: "မြန်မာစာ",
    pos: "noun",
    glosses: ["Burmese language"],
  },
  // ဖတ် — to read (sample sentence).
  { entryId: 13, headword: "ဖတ်", pos: "verb", glosses: ["to read"] },
  // ကျေးဇူး — thanks.
  { entryId: 14, headword: "ကျေးဇူး", pos: "noun", glosses: ["thanks"] },
];

export async function buildAppEngine(): Promise<SearchEngine> {
  // Filter out the bare ရေ from SEARCH_FIXTURE (entryId 3) so the
  // expanded one above is unambiguous.
  const merged = APP_FIXTURE.filter(
    (e, i, arr) => arr.findIndex(x => x.headword === e.headword) === i,
  );
  // buildSearchEngine has a fixed fixture set, so go through the
  // underlying load instead.
  const { load } = await import("@/app/lib/search");
  const { parseNgramModel } = await import("@/app/lib/segmenter");
  const { buildFixtureModel } = await import(
    "@/app/lib/lookup/__fixtures__/buildFixture"
  );
  const tinyNgram = (
    await import("@/app/lib/segmenter/__fixtures__/tiny-ngram.json")
  ).default;
  const segmenter = parseNgramModel(tinyNgram);
  const dictionary = await buildFixtureModel(merged);
  return load({ kind: "preloaded", segmenter, dictionary });
}

/** Render a React tree wrapped in a freshly-built `EngineProvider`. */
export async function renderWithEngine(
  ui: ReactElement,
): Promise<RenderResult & { engine: SearchEngine }> {
  clearAllStorage();
  const engine = await buildAppEngine();
  const result = render(
    <EngineProvider engine={engine}>{ui}</EngineProvider>,
  );
  return Object.assign(result, { engine });
}
