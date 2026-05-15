"use client";

// Top-level app component. Owns the user-facing state (active tab,
// search query, selected entry) and routes between sub-views based on
// the engine's `SearchResult`.
//
// Layout strategy: one tree, responsive via Tailwind breakpoints. The
// desktop chrome (sidebar + detail rail) is rendered with `hidden lg:flex`
// and the mobile chrome (top wordmark + bottom tab bar + entry sheet)
// with `lg:hidden`. The main content column is shared.

import { useEffect, useMemo, useRef, useState } from "react";
import { Logo, Wordmark } from "@/app/components/Logo";
import { SearchInput } from "@/app/components/SearchInput";
import { TabBar, type TabItem } from "@/app/components/TabBar";
import { type Accent } from "@/app/components/ThemeToggle";
import { Button } from "@/app/components/Button";
import { EntryDetail } from "@/app/components/EntryDetail";
import { Sheet } from "@/app/components/Sheet";
import { Toast } from "@/app/components/Toast";
import { Eyebrow } from "@/app/components/Ornament";
import {
  ClockIcon,
  MenuIcon,
  OfflineIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  StarIcon,
} from "@/app/components/Icon";
import { SettingsView } from "./SettingsView";
import {
  detectScript,
  search as runSearch,
  type SearchEngine,
} from "@/app/lib/search";
import { lookupForward } from "@/app/lib/lookup";
import type { Entry } from "@/app/lib/lookup";
import { useEngineState } from "@/app/lib/app/engine-context";
import { useFavorites, useHistory } from "@/app/lib/app/storage";
import {
  entryToFavorite,
  type FavoriteItem,
  type HistoryItem,
} from "@/app/lib/app/types";
import { SearchContent } from "./SearchContent";
import { HistoryView } from "./HistoryView";
import { FavoritesView } from "./FavoritesView";

type Tab = "search" | "history" | "fav" | "settings";

// Tabs surfaced in the mobile bottom bar. Settings is NOT in here —
// on mobile it opens as a `Sheet` from the hamburger button; on
// desktop it lives in the sidebar `mt-auto` group instead of the
// primary nav, since it's a system setting rather than a content tab.
const TAB_ITEMS: TabItem[] = [
  { id: "search", label: "Look up", icon: ({ size }) => <SearchIcon size={size} /> },
  { id: "history", label: "History", icon: ({ size }) => <ClockIcon size={size} /> },
  { id: "fav", label: "Saved", icon: ({ size }) => <StarIcon size={size} /> },
];

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
  const [accent, setAccent] = useState<Accent>("ruby");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLDivElement>(null);
  // Initial guess matches the input's natural ~50px so the first paint
  // looks right; ResizeObserver below corrects it once measured.
  const [shareBtnSize, setShareBtnSize] = useState(50);
  const history = useHistory();
  const favorites = useFavorites();

  useEffect(() => {
    const el = searchInputRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setShareBtnSize(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  useEffect(() => {
    // `--ruby` is remapped per accent via [data-accent] rules in
    // globals.css, and `.dark[data-accent="indigo"]` requires BOTH on
    // the same element — so they have to share `<html>` (.dark is
    // applied there by the theme effect below).
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);

  const result = useMemo(() => runSearch(engine, query), [engine, query]);

  const related = useMemo<Entry[]>(() => {
    if (!selected) return [];
    const found = lookupForward(engine.dictionary, selected.headword);
    if (!found) return [];
    return found.mergedPeers.filter(e => e.entryId !== selected.entryId);
  }, [engine, selected]);

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

  function handleHistorySelect(item: HistoryItem) {
    setQuery(item.query);
    setTab("search");
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
    if (!selected) return;
    favorites.toggle(entryToFavorite(selected));
  }

  function handleCopy() {
    if (!selected) return;
    const glosses = selected.glosses.join("; ");
    const text = glosses
      ? `${selected.headword} — ${glosses}`
      : selected.headword;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
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

  function handleShareEntry() {
    if (!selected) return;
    copyShareUrl(selected.headword);
  }

  return (
    <div
      className="h-dvh overflow-hidden bg-bg text-ink paper-tex relative"
      data-testid="app-shell"
    >
      <div className="h-full lg:grid lg:grid-cols-[220px_1fr_380px]">
        {/* Desktop sidebar */}
        <aside
          className="hidden lg:flex flex-col bg-bg-2 border-r border-border py-5"
          data-testid="desktop-sidebar"
        >
          <div className="px-5 pb-4">
            <Wordmark scale={1.05} />
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
                  <span>{it.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 px-5">
            <Eyebrow>Recent</Eyebrow>
            <ul className="mt-2.5 flex flex-col gap-2 list-none p-0 m-0">
              {history.items.slice(0, 5).map(h => (
                <li key={`${h.query}-${h.at}`}>
                  <button
                    type="button"
                    onClick={() => handleHistorySelect(h)}
                    className="w-full flex justify-between gap-2 items-baseline cursor-pointer text-left hover:text-ink"
                  >
                    <span
                      className={`${h.kind === "latin" ? "serif" : "mm"} text-[13px] text-ink-2 overflow-hidden whitespace-nowrap text-ellipsis`}
                    >
                      {h.query}
                    </span>
                  </button>
                </li>
              ))}
              {history.items.length === 0 && (
                <li className="serif italic text-[12px] text-ink-faint">
                  No recent searches.
                </li>
              )}
            </ul>
          </div>

          <div className="mt-auto flex flex-col">
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
              <span>Settings</span>
            </button>
            <div className="px-5 py-3 flex items-center gap-2 text-jade">
              <OfflineIcon size={13} />
              <span className="ui text-[10.5px] text-jade">Offline ready</span>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <main className="flex flex-col min-w-0 h-full">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center justify-between px-4 py-2.5">
            <Wordmark />
            <Button
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="p-2!"
            >
              <MenuIcon size={20} />
            </Button>
          </div>

          {/* Search input — only on the search tab */}
          {tab === "search" && (
            <div className="px-4 py-2.5 lg:px-8 lg:py-3.5 lg:border-b lg:border-border bg-bg">
              <div className="lg:max-w-2xl flex items-center gap-2">
                <div ref={searchInputRef} className="flex-1 min-w-0">
                  <SearchInput
                    aria-label="Search"
                    placeholder="ရှာဖွေရန် · search a word or sentence"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onClear={() => setQuery("")}
                    autoFocus
                  />
                </div>
                {query.trim() !== "" && (
                  <Button
                    variant="icon"
                    onClick={handleShareQuery}
                    aria-label="Share search"
                    data-testid="share-query"
                    style={{ width: shareBtnSize, height: shareBtnSize }}
                  >
                    <ShareIcon size={16} />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Active view */}
          <div className="flex-1 flex flex-col relative overflow-hidden min-h-0">
            {tab === "search" && (
              <SearchContent
                result={result}
                selectedEntryId={selected?.entryId ?? null}
                totalEntries={null}
                onSelectToken={t => t.result && openEntry(t.result.entry)}
                onSelectRow={entry => openEntry(entry)}
                onChip={handleChip}
              />
            )}
            {tab === "history" && (
              <HistoryView
                items={history.items}
                onSelect={handleHistorySelect}
                onClear={() => history.clear()}
              />
            )}
            {tab === "fav" && (
              <FavoritesView
                items={favorites.items}
                onSelect={handleFavoriteSelect}
              />
            )}
            {tab === "settings" && (
              <div className="flex-1 overflow-y-auto no-scroll paper-tex">
                {/* Inline desktop settings — no `onClose` (this is the
                    current "tab", not a transient sheet). The mobile
                    rendering uses the Sheet wrapper below instead. */}
                <SettingsView
                  accent={accent}
                  onAccentChange={setAccent}
                  dark={dark}
                  onDarkChange={setDark}
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
          </div>

          {/* Mobile tab bar */}
          <div className="lg:hidden">
            <TabBar
              items={TAB_ITEMS}
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
          {selected ? (
            <EntryDetail
              entry={selected}
              related={related}
              saved={favorites.isSaved(selected.entryId)}
              onSave={handleSaveToggle}
              onCopy={handleCopy}
              onShare={handleShareEntry}
              onSelectRelated={r => setSelected(r)}
            />
          ) : (
            <DetailRailPlaceholder />
          )}
        </aside>
      </div>

      {/* Mobile-only settings sheet — opened by the hamburger button.
          On desktop, settings lives inline in the main content area
          (rendered above when `tab === "settings"`), so the Sheet is
          suppressed via `lg:hidden`. */}
      <div className="lg:hidden">
        <Sheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          label="Settings"
        >
          <SettingsView
            accent={accent}
            onAccentChange={setAccent}
            dark={dark}
            onDarkChange={setDark}
            onClose={() => setSettingsOpen(false)}
          />
        </Sheet>
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
