"use client";

// LocalStorage-backed state hooks for the app's two persistent lists.
//
// Built on `useSyncExternalStore` so the read path is single-pass and
// SSR-safe: the server snapshot is the empty default, the client snapshot
// is whatever's currently in localStorage. Multiple subscribers stay in
// sync via a module-local listener set (cross-tab updates fire through
// the native `storage` event).

import { useCallback, useSyncExternalStore } from "react";
import type { FavoriteItem, HistoryItem } from "./types";

const HISTORY_KEY = "myangler.history.v1";
const FAVORITES_KEY = "myangler.favorites.v1";
const HISTORY_MAX = 100;

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  // Cross-tab: a `storage` event in another tab should trigger a re-read.
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) listener();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    set!.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// Cache the parsed snapshot per-key. `useSyncExternalStore` requires
// stable identity across renders when the underlying value hasn't
// changed; we keep both the raw string and the parsed value so we can
// detect changes cheaply and only re-parse when the raw string changes.
type Snapshot<T> = { raw: string | null; value: T };
const snapshotCache = new Map<string, Snapshot<unknown>>();

function readSnapshot<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const cached = snapshotCache.get(key) as Snapshot<T> | undefined;
  if (cached && cached.raw === raw) return cached.value;
  let value: T;
  if (raw === null) {
    value = fallback;
  } else {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  snapshotCache.set(key, { raw, value });
  return value;
}

function writeKey(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(value);
    window.localStorage.setItem(key, raw);
    snapshotCache.set(key, { raw, value });
  } catch {
    // Quota exceeded / disabled storage — surface as a no-op; the app
    // continues working in-memory for this session.
  }
  notify(key);
}

function useStoredList<T>(key: string): T[] {
  const sub = useCallback(
    (l: Listener) => subscribe(key, l),
    [key],
  );
  const getSnapshot = useCallback(() => readSnapshot<T[]>(key, []), [key]);
  const getServerSnapshot = useCallback(() => [] as T[], []);
  return useSyncExternalStore(sub, getSnapshot, getServerSnapshot);
}

interface HistoryStore {
  items: HistoryItem[];
  record: (item: Omit<HistoryItem, "at"> & { at?: number }) => void;
  clear: () => void;
}

/** History store. `record` is the only mutation: it prepends the new
 *  query, dedupes the previous identical-query row (so re-running the
 *  same lookup just refreshes the timestamp), and caps the list. */
export function useHistory(): HistoryStore {
  const items = useStoredList<HistoryItem>(HISTORY_KEY);

  const record = useCallback(
    (item: Omit<HistoryItem, "at"> & { at?: number }) => {
      const at = item.at ?? Date.now();
      const current = readSnapshot<HistoryItem[]>(HISTORY_KEY, []);
      const without = current.filter(p => p.query !== item.query);
      const next = [{ ...item, at }, ...without].slice(0, HISTORY_MAX);
      writeKey(HISTORY_KEY, next);
    },
    [],
  );

  const clear = useCallback(() => writeKey(HISTORY_KEY, []), []);

  return { items, record, clear };
}

interface FavoritesStore {
  items: FavoriteItem[];
  isSaved: (entryId: number) => boolean;
  toggle: (item: FavoriteItem) => void;
  remove: (entryId: number) => void;
  clear: () => void;
}

/** Favorites store. Keyed on `entryId` for uniqueness; `toggle` flips
 *  membership. The persisted order is newest first. */
export function useFavorites(): FavoritesStore {
  const items = useStoredList<FavoriteItem>(FAVORITES_KEY);

  const isSaved = useCallback(
    (entryId: number) => items.some(i => i.entryId === entryId),
    [items],
  );

  const toggle = useCallback((item: FavoriteItem) => {
    const current = readSnapshot<FavoriteItem[]>(FAVORITES_KEY, []);
    if (current.some(p => p.entryId === item.entryId)) {
      writeKey(
        FAVORITES_KEY,
        current.filter(p => p.entryId !== item.entryId),
      );
    } else {
      writeKey(FAVORITES_KEY, [
        { ...item, at: item.at || Date.now() },
        ...current,
      ]);
    }
  }, []);

  const remove = useCallback((entryId: number) => {
    const current = readSnapshot<FavoriteItem[]>(FAVORITES_KEY, []);
    writeKey(
      FAVORITES_KEY,
      current.filter(p => p.entryId !== entryId),
    );
  }, []);

  const clear = useCallback(() => writeKey(FAVORITES_KEY, []), []);

  return { items, isSaved, toggle, remove, clear };
}

/** Test-only helper to wipe both keys and the snapshot cache between
 *  tests, so the next render starts from a clean slate. */
export function clearAllStorage(): void {
  snapshotCache.clear();
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(HISTORY_KEY);
  window.localStorage.removeItem(FAVORITES_KEY);
}

export { HISTORY_KEY, FAVORITES_KEY, HISTORY_MAX };
