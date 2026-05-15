// App-level data types: stored history entries and saved favorites.
//
// Stored in localStorage as plain JSON, so every shape must be
// serializable (no `Date`, no class instances). Timestamps are stored
// as epoch-millisecond numbers and rendered relative at read time.

import type { Entry } from "@/app/lib/lookup";

/** One row in the user's search history. `query` is the raw input the
 *  user typed; `kind` is the script class (drives display formatting),
 *  `at` is the timestamp the search was committed. Stored in chronological
 *  order, newest first. */
export interface HistoryItem {
  query: string;
  kind: "burmese" | "latin" | "mixed";
  at: number;
}

/** One saved entry. Stores the snapshot of the entry at save time —
 *  re-resolving against the dictionary on every render would force the
 *  engine to be loaded just to read the saved list. */
export interface FavoriteItem {
  entryId: number;
  headword: string;
  pos: string;
  glosses: string[];
  ipa: string | null;
  /** Optional user-supplied category tag. */
  tag?: string;
  at: number;
}

/** Helper to derive a `FavoriteItem` from an `Entry`. */
export function entryToFavorite(entry: Entry, at: number = Date.now()): FavoriteItem {
  return {
    entryId: entry.entryId,
    headword: entry.headword,
    pos: entry.pos,
    glosses: entry.glosses,
    ipa: entry.ipa,
    at,
  };
}
