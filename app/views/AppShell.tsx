"use client";

// Top-level app component. Owns the user-facing state (active tab,
// search query, selected entry) and routes between sub-views based on
// the engine's `SearchResult`.
//
// Layout strategy: one tree, responsive via Tailwind breakpoints. The
// desktop chrome (sidebar + detail rail) is rendered with `hidden lg:flex`
// and the mobile chrome (top wordmark + bottom tab bar + entry sheet)
// with `lg:hidden`. The main content column is shared.

import { useEffect, useMemo, useState } from "react";
import { Logo, Wordmark } from "@/app/components/Logo";
import { SearchInput } from "@/app/components/SearchInput";
import { TabBar, type TabItem } from "@/app/components/TabBar";
import { Button } from "@/app/components/Button";
import { EntryDetail } from "@/app/components/EntryDetail";
import { WordOfTheDay } from "@/app/components/WordOfTheDay";
import { Sheet } from "@/app/components/Sheet";
import { Toast } from "@/app/components/Toast";
import { Eyebrow, Flourish } from "@/app/components/Ornament";
import {
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  StarIcon,
} from "@/app/components/Icon";
import { SettingsView } from "./SettingsView";
import { InstallGuide } from "@/app/components/InstallGuide";
import {
  detectScript,
  search as runSearch,
  type SearchEngine,
  type SearchResult,
} from "@/app/lib/search";
import { lookupForward, relatedFor } from "@/app/lib/lookup";
import type { Entry } from "@/app/lib/lookup";
import { dayOfYear, pickWordOfTheDay } from "@/app/lib/app/wordOfTheDay";
import { useEngineState } from "@/app/lib/app/engine-context";
import { useFavorites, useHistory } from "@/app/lib/app/storage";
import { usePreferences } from "@/app/lib/app/preferences";
import { useInstallPrompt } from "@/app/lib/app/install-prompt";
import {
  entryToFavorite,
  type FavoriteItem,
  type HistoryItem,
} from "@/app/lib/app/types";
import { SearchContent } from "./SearchContent";
import { HistoryView } from "./HistoryView";
import { FavoritesView } from "./FavoritesView";

type Tab = "search" | "history" | "fav" | "settings";

// Primary content tabs — also rendered in the desktop sidebar. On
// desktop, Settings stays in the `mt-auto` group beneath these (it's a
// system control, not a content tab); on mobile it joins the bottom
// `TabBar` via `MOBILE_TAB_ITEMS` so the user always has it at thumb's
// reach without a hamburger menu.
const TAB_ITEMS: TabItem[] = [
  { id: "search", label: "Look up", mm: "ရှာဖွေ", icon: ({ size }) => <SearchIcon size={size} /> },
  { id: "history", label: "History", mm: "သမိုင်း", icon: ({ size }) => <ClockIcon size={size} /> },
  { id: "fav", label: "Saved", mm: "သိမ်းဆည်း", icon: ({ size }) => <StarIcon size={size} /> },
];

const MOBILE_TAB_ITEMS: TabItem[] = [
  ...TAB_ITEMS,
  { id: "settings", label: "Settings", mm: "ဆက်တင်", icon: ({ size }) => <SettingsIcon size={size} /> },
];

// Starter words shown in the sidebar's "Recent" slot before the user has
// any history, so the column reads as an invitation rather than a void.
// English hints avoid collisions with the idle-view TRY chips (water /
// thank you) so a fresh-load screen has no duplicated tappable text.
const SIDEBAR_SUGGESTIONS: readonly { mm: string; en: string }[] = [
  { mm: "ချစ်", en: "love" },
  { mm: "ကောင်း", en: "good" },
  { mm: "စား", en: "eat" },
  { mm: "မိတ်ဆွေ", en: "friend" },
];

/** Plain-text rendering of the current result for the "Copy all" action.
 *  A breakdown copies the sentence plus a `token — glosses` line per
 *  block; a reverse list copies a `headwords — gloss` line per row; any
 *  other state falls back to the raw query. */
function resultToCopyText(result: SearchResult, query: string): string {
  if (result.kind === "breakdown") {
    const sentence = result.tokens
      .map(t => t.token)
      .join(result.script === "english" ? " " : "");
    const lines = result.tokens.map(t => {
      const entry = t.result?.entry;
      return entry
        ? `${t.token} — ${entry.glosses.slice(0, 3).join("; ")}`
        : `${t.token} — (no match)`;
    });
    return [sentence, "", ...lines].join("\n");
  }
  if (result.kind === "reverse") {
    return result.rows
      .map(row => {
        const heads = row.entries.map(e => e.headword).join(", ");
        const gloss = row.entries[0]?.glosses[0] ?? row.key;
        return `${heads} — ${gloss}`;
      })
      .join("\n");
  }
  return query.trim();
}

/** Short mode label for the search-bar breadcrumb (echoes the reference
 *  dictionary's "Analysis" header). Reflects what the current input is
 *  doing rather than a fixed title. */
function lookupLabel(result: SearchResult): string {
  if (result.kind === "breakdown") return "Analysis";
  if (result.kind === "reverse") return "Results";
  return "Look up";
}

/** The entry the detail rail should default to for the current lookup —
 *  its top hit. A reverse list's first row, the first *matched* tile of a
 *  breakdown, or `null` when the input produced nothing to show (empty /
 *  unrecognized / every tile a miss). The rail follows this as the query
 *  changes, so a fresh search replaces the previously-highlighted word
 *  (or the idle word of the day) with its own top result. */
function topResultEntry(result: SearchResult): Entry | null {
  if (result.kind === "reverse") {
    return result.rows[0]?.entries[0] ?? null;
  }
  if (result.kind === "breakdown") {
    for (const token of result.tokens) {
      if (token.result) return token.result.entry;
    }
  }
  return null;
}

/** Direction of the active lookup, e.g. "မြန်မာ → English", or null when
 *  there's nothing to act on yet. */
function lookupDirection(result: SearchResult): string | null {
  const mmToEn = "မြန်မာ → English";
  const enToMm = "English → မြန်မာ";
  if (result.kind === "breakdown") {
    return result.script === "english" ? enToMm : mmToEn;
  }
  if (result.kind === "reverse") {
    return result.script === "latin" ? enToMm : mmToEn;
  }
  return null;
}

type AppShellProps = {
  /** Default starting tab — used by tests. */
  initialTab?: Tab;
};

export function AppShell({ initialTab = "search" }: AppShellProps) {
  const state = useEngineState();
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.error.message} />;
  return <AppShellReady engine={state.engine} initialTab={initialTab} />;
}

function AppShellReady({
  engine,
  initialTab,
}: {
  engine: SearchEngine;
  initialTab: Tab;
}) {
  // Theme + accent live in localStorage (key: `myangler.preferences.v1`)
  // and are pre-applied to `<html>` by the inline script in
  // `app/layout.tsx` before hydration. `usePreferences` is the React
  // mirror; its setters persist + update the DOM in one call, so we no
  // longer need the old `useEffect` mirrors for `accent` / `dark`.
  const { accent, setAccent, dark, setDark } = usePreferences();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  // Featured word for the idle detail rail. Computed client-side after
  // mount (so SSR and the first client render agree — the rail shows the
  // placeholder until this fills) and stable for the whole day.
  const [wordOfDay, setWordOfDay] = useState<Entry | null>(null);
  const history = useHistory();
  const favorites = useFavorites();
  const install = useInstallPrompt();

  // Seed the query from `?q=` on first mount. Initial useState stays
  // empty so SSR-rendered HTML matches the first client render — no
  // hydration mismatch — and we pull the URL value in afterwards.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is only readable on the client; doing this in a lazy useState initializer would cause a server/client hydration mismatch.
    if (initial) setQuery(initial);
  }, []);

  // Mirror `query` back into the URL. `replaceState` (not `pushState`)
  // so a long search doesn't fill the back stack with one entry per
  // keystroke.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const current = params.get("q") ?? "";
    if (current === query) return;
    if (query) params.set("q", query);
    else params.delete("q");
    const search = params.toString();
    const next =
      window.location.pathname +
      (search ? `?${search}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", next);
  }, [query]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const result = useMemo(() => runSearch(engine, query), [engine, query]);

  // The detail rail follows the *current lookup*: an explicit selection
  // (a tapped tile / row, the word of the day, a saved entry) wins;
  // otherwise it shows the top hit of the active search. A fresh search
  // clears `selected` (see `handleQueryChange`), so the rail switches to
  // the new lookup's top result instead of lingering on the previously-
  // highlighted word or the idle word of the day.
  const topResult = useMemo(() => topResultEntry(result), [result]);
  const detailEntry = selected ?? topResult;

  // Anchor Forms to the *displayed* entry, not whatever sense
  // `lookupForward(headword)` happens to pick first. On polysemous
  // headwords (e.g. ကြိုက် verb "to like" vs conj "while") the two
  // senses' Forms must derive from their own glosses, otherwise one
  // sense's panel fills with peers gathered for the other sense.
  const related = useMemo<Entry[]>(() => {
    if (!detailEntry) return [];
    return relatedFor(engine.dictionary, detailEntry);
  }, [engine, detailEntry]);

  useEffect(() => {
    setWordOfDay(
      pickWordOfTheDay(
        engine.dictionary,
        engine.segmenter.unigram,
        dayOfYear(new Date()),
      ),
    );
  }, [engine]);

  // Single setter for the search query. A fresh search supersedes any
  // tile/row the user had open, so drop the explicit selection: the
  // detail rail then follows the new lookup's top result, and clearing
  // the field (via the X button or by deleting all characters) lets the
  // rail / mobile sheet fall back to the idle word-of-the-day placeholder
  // rather than leaving a stale entry with no query to anchor it to.
  function handleQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (value === "") setModalOpen(false);
  }

  function recordQuery(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const script = detectScript(trimmed);
    if (script === "unknown") return;
    history.record({ query: trimmed, kind: script });
  }

  function openEntry(entry: Entry) {
    setSelected(entry);
    setModalOpen(true);
    recordQuery(query.trim() || entry.headword);
  }

  function closeEntry() {
    setModalOpen(false);
  }

  function handleChip(sample: string) {
    setQuery(sample);
    setTab("search");
    setSelected(null);
    setModalOpen(false);
  }

  // Open the featured word: drive the query (so the main column shows its
  // breakdown) and select it (so the rail shows the full entry), matching
  // a normal result tap.
  function handleSelectWordOfDay(entry: Entry) {
    setQuery(entry.headword);
    setTab("search");
    setSelected(entry);
    setModalOpen(true);
    recordQuery(entry.headword);
  }

  function handleHistorySelect(item: HistoryItem) {
    setQuery(item.query);
    setTab("search");
    // No explicit selection — the rail follows the re-run query's top result.
    setSelected(null);
    setModalOpen(false);
  }

  function handleFavoriteSelect(item: FavoriteItem) {
    const found = lookupForward(engine.dictionary, item.headword);
    if (found) {
      setSelected(found.entry);
    } else {
      setSelected({
        entryId: item.entryId,
        headword: item.headword,
        pos: item.pos,
        glosses: item.glosses,
        normalizedGlosses: item.glosses.map(g => g.toLowerCase()),
        ipa: item.ipa,
      });
    }
    setTab("search");
    setQuery(item.headword);
    setModalOpen(true);
  }

  function handleSaveToggle() {
    if (!detailEntry) return;
    const wasSaved = favorites.isSaved(detailEntry.entryId);
    favorites.toggle(entryToFavorite(detailEntry));
    setToast(wasSaved ? "Removed from saved" : "Saved");
  }

  function handleCopy() {
    if (!detailEntry) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(detailEntry.headword);
    }
    setToast("Copied");
  }

  function handleDarkChange(next: boolean) {
    setDark(next);
    setToast(next ? "Dark mode on" : "Light mode on");
  }

  function handleAccentChange(next: typeof accent) {
    setAccent(next);
    setToast(`Accent: ${next[0].toUpperCase()}${next.slice(1)}`);
  }

  function handleHistoryClear() {
    history.clear();
    setToast("History cleared");
  }

  function handleFavoriteRemove(item: FavoriteItem) {
    favorites.remove(item.entryId);
    setToast("Removed from saved");
  }

  function shareUrlFor(q: string): string {
    const params = new URLSearchParams();
    params.set("q", q);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }

  function copyShareUrl(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const url = shareUrlFor(trimmed);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
    }
    setToast("Link copied");
  }

  function handleShareQuery() {
    copyShareUrl(query);
  }

  function handleCopyAll() {
    const text = resultToCopyText(result, query);
    if (!text) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
    setToast("Copied");
  }

  function handleShareEntry() {
    if (!detailEntry) return;
    copyShareUrl(detailEntry.headword);
  }

  return (
    <div
      className="h-dvh overflow-hidden bg-bg text-ink paper-tex relative"
      data-testid="app-shell"
    >
      <div className="h-full lg:grid lg:grid-cols-[220px_1fr_380px] lg:grid-rows-[minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside
          className="hidden lg:flex flex-col bg-bg-2 border-r border-border py-5"
          data-testid="desktop-sidebar"
        >
          <div className="px-5 pb-4">
            {/* `href="/"` is a real anchor, not a `<Link>` — we want a
                full navigation so every piece of in-memory state
                (query, selected entry, open sheets) is dropped and
                the app remounts on a fresh URL. */}
            <Wordmark scale={1.05} href="/" />
          </div>
          <nav className="flex flex-col" aria-label="Primary">
            {TAB_ITEMS.map(it => {
              const isActive = it.id === tab;
              const Icon = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setTab(it.id as Tab)}
                  className={`flex items-center gap-3 px-5 py-2.5 text-left cursor-pointer ui text-[13px] tracking-tight ${
                    isActive
                      ? "text-ink border-l-2 border-gold bg-[color-mix(in_oklab,var(--gold)_14%,transparent)]"
                      : "text-ink-3 border-l-2 border-transparent hover:text-ink-2"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span className="flex flex-col leading-tight">
                    <span>{it.label}</span>
                    {it.mm && (
                      <span
                        className="mm text-[10px] text-ink-3 leading-tight mt-0.5"
                        aria-hidden="true"
                      >
                        {it.mm}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 px-5">
            <Eyebrow>{history.items.length === 0 ? "Try" : "Recent"}</Eyebrow>
            {history.items.length === 0 ? (
              <ul className="mt-2.5 flex flex-col gap-2 list-none p-0 m-0">
                {SIDEBAR_SUGGESTIONS.map(s => (
                  <li key={s.mm}>
                    <button
                      type="button"
                      onClick={() => handleChip(s.mm)}
                      className="w-full flex justify-between gap-2 items-baseline cursor-pointer text-left group"
                    >
                      <span className="mm text-[13px] text-ink-2 leading-[2.5] group-hover:text-ink">
                        {s.mm}
                      </span>
                      <span className="serif italic text-[11px] text-ink-3">
                        {s.en}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-2 list-none p-0 m-0">
                {history.items.slice(0, 5).map(h => (
                  <li key={`${h.query}-${h.at}`}>
                    <button
                      type="button"
                      onClick={() => handleHistorySelect(h)}
                      className="w-full flex justify-between gap-2 items-baseline cursor-pointer text-left hover:text-ink"
                    >
                      <span
                        className={`${h.kind === "latin" ? "serif" : "mm leading-[2.5]"} text-[13px] text-ink-2 overflow-hidden whitespace-nowrap text-ellipsis`}
                      >
                        {h.query}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-auto flex flex-col">
            <div className="px-5 pt-2 pb-3 flex justify-center" aria-hidden="true">
              <Flourish width={92} className="opacity-45" />
            </div>
            <button
              type="button"
              onClick={() => setTab("settings")}
              aria-current={tab === "settings" ? "page" : undefined}
              className={`flex items-center gap-3 px-5 py-2.5 text-left cursor-pointer ui text-[13px] tracking-tight ${
                tab === "settings"
                  ? "text-ink border-l-2 border-gold bg-[color-mix(in_oklab,var(--gold)_14%,transparent)]"
                  : "text-ink-3 border-l-2 border-transparent hover:text-ink-2"
              }`}
            >
              <SettingsIcon size={17} />
              <span className="flex flex-col leading-tight">
                <span>Settings</span>
                <span
                  className="mm text-[10px] text-ink-3 leading-tight mt-0.5"
                  aria-hidden="true"
                >
                  ဆက်တင်
                </span>
              </span>
            </button>
          </div>
        </aside>

        {/* Main column */}
        <main className="flex flex-col min-w-0 h-full">
          {/* Mobile header — Settings lives on the bottom TabBar, so the
              right side is the install entry point on uninstalled mobile,
              and a decorative manuscript flourish everywhere else (the
              installed PWA, where the affordance would be confusing). */}
          <div className="lg:hidden flex items-center justify-between px-4 py-2.5">
            <Wordmark href="/" />
            {install.available ? (
              <button
                type="button"
                onClick={() => setInstallOpen(true)}
                aria-label="Add to Home Screen"
                data-testid="header-install"
                className="flex items-center gap-1.5 px-2 py-1.5 -mr-1 text-gold-deep hover:text-gold transition-colors cursor-pointer"
              >
                <DownloadIcon size={14} />
                <span className="eyebrow eyebrow-gold">Install</span>
              </button>
            ) : (
              <div className="pr-0.5" data-testid="header-ornament">
                <Flourish />
              </div>
            )}
          </div>

          {/* Search input — only on the search tab. Full-width so its
              left/right edges line up with the result/breakdown content
              below; Share / Copy-all actions sit above it (shown once
              there's a query, à la the reference dictionary's top bar). */}
          {tab === "search" && (
            <div className="py-3 lg:py-4 lg:border-b lg:border-border bg-bg">
              {/* Header row uses `px-5.5` — the same padding as the
                  History / Saved / Settings view headers — so "Look up"
                  lines up with their "Recent" / "Library" eyebrows, and
                  the Share / Copy-all actions sit where those views' header
                  actions do. Actions stay mounted (disabled until there's a
                  query) so the input doesn't shift down when typing starts. */}
              <div className="px-5.5 flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <Eyebrow>{lookupLabel(result)}</Eyebrow>
                  {lookupDirection(result) && (
                    <span className="ui text-[10px] tracking-[0.1em] uppercase text-ink-3 truncate hidden sm:inline">
                      · {lookupDirection(result)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    onClick={handleShareQuery}
                    disabled={query.trim() === ""}
                    aria-label="Share search"
                    data-testid="share-query"
                    className="text-xs! px-2.5!"
                  >
                    <ShareIcon size={15} /> Share
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleCopyAll}
                    disabled={query.trim() === ""}
                    aria-label="Copy all results"
                    data-testid="copy-all"
                    className="text-xs! px-2.5!"
                  >
                    <CopyIcon size={15} /> Copy all
                  </Button>
                </div>
              </div>
              {/* Input stays at `px-4` so its edges line up with the
                  breakdown / results content below it. */}
              <div className="px-4">
                <SearchInput
                  aria-label="Search"
                  placeholder="ရှာဖွေရန် · search a word or sentence"
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onClear={() => handleQueryChange("")}
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Active view */}
          <div className="flex-1 flex flex-col relative overflow-hidden min-h-0">
            {tab === "search" && (
              <SearchContent
                result={result}
                selectedEntryId={detailEntry?.entryId ?? null}
                onSelectToken={t => t.result && openEntry(t.result.entry)}
                onSelectRow={entry => openEntry(entry)}
                onChip={handleChip}
              />
            )}
            {tab === "history" && (
              <HistoryView
                items={history.items}
                onSelect={handleHistorySelect}
                onClear={handleHistoryClear}
              />
            )}
            {tab === "fav" && (
              <FavoritesView
                items={favorites.items}
                onSelect={handleFavoriteSelect}
                onRemove={handleFavoriteRemove}
              />
            )}
            {tab === "settings" && (
              <div className="flex-1 overflow-y-auto no-scroll paper-tex">
                {/* Settings is a tab on every breakpoint now — no
                    `onClose` because it's a destination, not a transient
                    sheet. Users dismiss it by selecting another tab. */}
                <SettingsView
                  accent={accent}
                  onAccentChange={handleAccentChange}
                  dark={dark}
                  onDarkChange={handleDarkChange}
                />
              </div>
            )}

            {/* Mobile entry sheet */}
            <div className="lg:hidden">
              <Sheet
                open={modalOpen && !!selected}
                onClose={closeEntry}
                label="Entry detail"
              >
                {selected && (
                  <EntryDetail
                    entry={selected}
                    related={related}
                    saved={favorites.isSaved(selected.entryId)}
                    onSave={handleSaveToggle}
                    onCopy={handleCopy}
                    onShare={handleShareEntry}
                    onClose={closeEntry}
                    onSelectRelated={r => setSelected(r)}
                  />
                )}
              </Sheet>
            </div>

            {/* Install-to-Home-Screen guide. Auto-opens on first mobile
                (non-standalone) visit; mounted here so it shares the
                relatively-positioned overlay container with the entry
                sheet above. */}
            <InstallGuide
              open={installOpen}
              onClose={() => setInstallOpen(false)}
              platform={install.platform}
            />
          </div>

          {/* Mobile tab bar */}
          <div className="lg:hidden">
            <TabBar
              items={MOBILE_TAB_ITEMS}
              active={tab}
              onChange={id => {
                setTab(id as Tab);
                setModalOpen(false);
              }}
            />
          </div>
        </main>

        {/* Desktop detail rail */}
        <aside
          className="hidden lg:flex flex-col bg-paper border-l border-border min-w-0 overflow-hidden"
          aria-label="Entry detail"
          data-testid="detail-rail"
        >
          {detailEntry ? (
            <EntryDetail
              entry={detailEntry}
              related={related}
              saved={favorites.isSaved(detailEntry.entryId)}
              onSave={handleSaveToggle}
              onCopy={handleCopy}
              onShare={handleShareEntry}
              onSelectRelated={r => setSelected(r)}
            />
          ) : wordOfDay ? (
            <WordOfTheDay entry={wordOfDay} onOpen={handleSelectWordOfDay} />
          ) : (
            <DetailRailPlaceholder />
          )}
        </aside>
      </div>

      <Toast open={toast !== null} message={toast ?? ""} />
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 paper-tex"
      data-testid="loading-state"
      role="status"
      aria-live="polite"
    >
      <Logo size={68} />
      <div className="serif italic text-ink-3 text-lg">Loading dictionary…</div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 paper-tex px-6 text-center"
      data-testid="error-state"
      role="alert"
    >
      <Logo size={68} />
      <h1 className="serif text-2xl text-ink">Couldn&rsquo;t load the dictionary</h1>
      <p className="serif italic text-ink-3 max-w-md">{message}</p>
    </div>
  );
}

function DetailRailPlaceholder() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3"
      data-testid="detail-placeholder"
    >
      <Logo size={44} />
      <div className="serif italic text-ink-3">
        Search for a word or pick one from the breakdown to see its entry here.
      </div>
    </div>
  );
}
