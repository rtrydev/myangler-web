import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EngineProvider } from "@/app/lib/app/engine-context";
import {
  buildAppEngine,
  renderWithEngine,
} from "@/app/lib/app/__fixtures__/buildAppFixture";
import { clearAllStorage, FAVORITES_KEY } from "@/app/lib/app/storage";
import type { FavoriteItem, HistoryItem } from "@/app/lib/app/types";
import { AppShell } from "./AppShell";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function stubUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

function stubMatchMedia(matcher: (q: string) => boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

function clearMatchMedia() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).matchMedia;
}

// `Settings` shows up twice in the DOM at jsdom-render time: once in
// the mobile TabBar (the new entry that replaced the hamburger) and
// once in the desktop sidebar's `mt-auto` group. The TabBar lives at
// the bottom of <main>, the sidebar entry lives in the aside above —
// so `getAllByRole` returns desktop first, mobile second.
function getMobileSettingsTab() {
  const all = screen.getAllByRole("button", { name: /^settings$/i });
  return all[all.length - 1];
}

// Locate text inside the active results/breakdown column. The desktop
// detail rail renders a "word of the day" chosen from the dictionary's
// most popular headwords by the calendar day, so on a given run it can be
// any common fixture headword (e.g. ပြော / မြန်မာ / စကား). A bare
// `getByText` on such a headword would then match both the result row and
// the rail; scoping to the result column keeps these assertions
// unambiguous regardless of which word the day happens to surface.
function inResults(text: string): HTMLElement {
  const view =
    screen.queryByTestId("results-view") ??
    screen.getByTestId("breakdown-view");
  return within(view).getByText(text);
}

beforeEach(() => {
  clearAllStorage();
  // Reset URL between tests — `replaceState` from a prior test would
  // otherwise leak `?q=…` into the next one's initial mount.
  window.history.replaceState({}, "", "/");
});

describe("AppShell · ready state", () => {
  test("renders the app shell once the engine is ready", async () => {
    await renderWithEngine(<AppShell />);
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /search/i })).toBeInTheDocument();
  });

  test("does not expose theme/accent controls directly in the header", async () => {
    await renderWithEngine(<AppShell />);
    // Theme/accent controls live inside the Settings tab — they should
    // never be present in the top chrome itself.
    expect(
      screen.queryByRole("button", { name: /toggle theme/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /accent ruby/i }),
    ).not.toBeInTheDocument();
  });

  test("the mobile header has the decorative ornament and no hamburger button", async () => {
    await renderWithEngine(<AppShell />);
    // Settings now lives on the bottom TabBar; the old hamburger is
    // replaced by a purely decorative manuscript ornament.
    expect(
      screen.queryByRole("button", { name: /open settings/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("header-ornament")).toBeInTheDocument();
  });
});

describe("AppShell · mobile settings tab", () => {
  test("the mobile bottom-bar Settings tab shows the theme & accent controls inline (no dialog)", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);

    await user.click(getMobileSettingsTab());

    // Inline view — not wrapped in a dialog the way the old hamburger
    // sheet used to be.
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: /settings/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /toggle theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /accent ruby/i }),
    ).toBeInTheDocument();
  });

  test("toggling the theme from the mobile Settings tab applies the dark class to <html>", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(getMobileSettingsTab());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });

  test("Settings (as a tab) has no Close button — users dismiss it by selecting another tab", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(getMobileSettingsTab());
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    // The old transient Sheet exposed an X with aria-label "Close".
    // A tab destination shouldn't.
    expect(
      screen.queryByRole("button", { name: /^close$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("AppShell · desktop settings view", () => {
  test("the desktop sidebar Settings entry swaps the main content area, NOT a sheet", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);

    // The desktop entry has visible text "Settings" — that's its
    // accessible name; it deliberately omits the "Open settings"
    // aria-label so it reads like the other nav items.
    const sidebar = screen.getByTestId("desktop-sidebar");
    const settingsNav = within(sidebar).getByRole("button", {
      name: /^settings$/i,
    });

    await user.click(settingsNav);

    // The settings content is now in the main column — NOT wrapped in
    // a dialog (the inline view has no Sheet around it).
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: /settings/i }),
    ).not.toBeInTheDocument();

    // The active nav item gets `aria-current="page"`.
    expect(settingsNav).toHaveAttribute("aria-current", "page");
  });

  test("clicking another tab navigates away from the inline settings", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const sidebar = screen.getByTestId("desktop-sidebar");
    await user.click(
      within(sidebar).getByRole("button", { name: /^settings$/i }),
    );
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();

    // The History tab in the desktop sidebar should swap content back.
    await user.click(within(sidebar).getByRole("button", { name: /history/i }));
    expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-view")).toBeInTheDocument();
  });

  test("the inline settings has no Close button — it's a tab, not a transient sheet", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const sidebar = screen.getByTestId("desktop-sidebar");
    await user.click(
      within(sidebar).getByRole("button", { name: /^settings$/i }),
    );

    // The mobile sheet exposes its own X button (with aria-label "Close");
    // the inline desktop view should NOT — settings is the current tab.
    expect(
      screen.queryByRole("button", { name: /^close$/i }),
    ).not.toBeInTheDocument();
  });

  test("toggling the theme inside the inline view applies the dark class to <html>", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const sidebar = screen.getByTestId("desktop-sidebar");
    await user.click(
      within(sidebar).getByRole("button", { name: /^settings$/i }),
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});

describe("AppShell · accent application", () => {
  test("choosing an accent writes data-accent on <html> (so it sits with .dark)", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(getMobileSettingsTab());
    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    expect(document.documentElement.dataset.accent).toBe("jade");
    expect(document.body.dataset.accent).toBeUndefined();
  });

  test("accent persists across leaving and returning to the Settings tab", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);

    await user.click(getMobileSettingsTab());
    await user.click(screen.getByRole("button", { name: /accent jade/i }));

    // Leave settings (back to Look up) and come back.
    const lookupBtns = screen.getAllByRole("button", { name: /look up/i });
    await user.click(lookupBtns[lookupBtns.length - 1]);
    await user.click(getMobileSettingsTab());

    expect(
      screen.getByRole("button", { name: /accent jade/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.accent).toBe("jade");
  });
});

describe("AppShell · preferences persistence (the reload story)", () => {
  test("theme + accent chosen in one session are restored on the next mount", async () => {
    const user = userEvent.setup();

    // First mount — user opens settings, flips dark mode, picks an accent.
    // Note: `renderWithEngine` calls `clearAllStorage()` internally, so we
    // use it once for the first mount and then drive the second mount
    // through plain `render` to keep the persisted prefs intact.
    const first = await renderWithEngine(<AppShell />);
    const engine = first.engine;
    await user.click(getMobileSettingsTab());
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.accent).toBe("jade");

    // Unmount, leaving localStorage intact — simulates a reload without
    // resetting `<html>` (the pre-hydration script in `layout.tsx` would
    // restore the DOM in real Next.js).
    first.unmount();

    // Second mount in the same jsdom — the new AppShell must surface the
    // persisted prefs in its React state (so the settings UI shows the
    // correct selected accent and dark-mode toggle).
    render(
      <EngineProvider engine={engine}>
        <AppShell />
      </EngineProvider>,
    );
    await user.click(getMobileSettingsTab());
    expect(
      screen.getByRole("button", { name: /accent jade/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /toggle theme/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.accent).toBe("jade");
  });
});

// Loading and error states are covered exhaustively by
// `engine-context.test.tsx` — exercising them here would force the
// EngineProvider to start a real `load()` against URLs the test
// environment can't serve, which would contaminate sql.js's module-
// level state for every subsequent test in this file.

describe("AppShell · search idle → results", () => {
  test("starts on the idle view with the hero, steps, and chips", async () => {
    await renderWithEngine(<AppShell />);
    expect(screen.getByTestId("idle-view")).toBeInTheDocument();
    expect(screen.getByText(/pocket dictionary/i)).toBeInTheDocument();
  });

  test("typing English routes through the reverse engine and shows ranked results", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() =>
      expect(screen.getByTestId("results-view")).toBeInTheDocument(),
    );
    // ပြော → "speak" in the fixture set
    expect(inResults("ပြော")).toBeInTheDocument();
  });

  test("typing Burmese routes through the breakdown engine and shows word blocks", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "မြန်မာစကား");
    await waitFor(() =>
      expect(screen.getByTestId("breakdown-view")).toBeInTheDocument(),
    );
    expect(inResults("မြန်မာ")).toBeInTheDocument();
    expect(inResults("စကား")).toBeInTheDocument();
  });

  test("clicking a sample chip seeds the query", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    // The TRY chip is a role=button; query by role so it stays unambiguous
    // against any plain-text gloss the word-of-the-day rail happens to show.
    await user.click(screen.getByRole("button", { name: "water" }));
    const input = screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
    expect(input.value).toBe("water");
  });
});

describe("AppShell · entry interaction & history", () => {
  test("clicking a result row opens the entry sheet with the headword, IPA-or-POS, and glosses", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => inResults("ပြော"));

    await user.click(inResults("ပြော"));

    const dialogs = await screen.findAllByRole("dialog", { name: /entry detail/i });
    // Only the mobile dialog is rendered (lg:hidden suppresses on desktop in CSS,
    // but in jsdom both are produced; the same headword should appear in the
    // sheet and the desktop rail).
    expect(dialogs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId("entry-headword").length).toBeGreaterThan(0);
    expect(within(dialogs[0]).getByTestId("entry-headword")).toHaveTextContent(
      "ပြော",
    );
  });

  test("opening an entry records the query into history", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => inResults("ပြော"));
    await user.click(inResults("ပြော"));

    // Switch to the history tab — there are two TabBar buttons (mobile +
    // desktop sidebar both render in jsdom). Click the first.
    const histBtns = screen.getAllByRole("button", { name: /history/i });
    await user.click(histBtns[0]);
    expect(screen.getByTestId("history-view")).toBeInTheDocument();
    expect(screen.getAllByText("speak").length).toBeGreaterThan(0);
  });

  test("Save toggles favorite membership and the badge flips to Saved", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => inResults("ပြော"));
    await user.click(inResults("ပြော"));

    const saveBtns = await screen.findAllByRole("button", { name: /^save$/i });
    await user.click(saveBtns[0]);
    expect(
      (await screen.findAllByRole("button", { name: /saved/i })).length,
    ).toBeGreaterThan(0);

    // Persisted to localStorage
    const stored = JSON.parse(
      window.localStorage.getItem(FAVORITES_KEY) ?? "[]",
    ) as FavoriteItem[];
    expect(stored.some(f => f.headword === "ပြော")).toBe(true);
  });

  test("Escape closes the mobile entry sheet", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => inResults("ပြော"));
    await user.click(inResults("ပြော"));

    expect(
      (await screen.findAllByRole("dialog", { name: /entry detail/i })).length,
    ).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /entry detail/i }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("AppShell · history navigation", () => {
  test("clicking a history item re-runs that query and returns to the search tab", async () => {
    const user = userEvent.setup();
    const history: HistoryItem[] = [
      { query: "speak", kind: "latin", at: Date.now() },
    ];
    window.localStorage.setItem(
      "myangler.history.v1",
      JSON.stringify(history),
    );
    const engine = await buildAppEngine();
    render(
      <EngineProvider engine={engine}>
        <AppShell initialTab="history" />
      </EngineProvider>,
    );

    await waitFor(() => screen.getByTestId("history-view"));
    await user.click(screen.getByTestId("history-item-0"));

    expect(screen.getByTestId("results-view")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
    expect(input.value).toBe("speak");
  });

  test("Clear history empties the list", async () => {
    const user = userEvent.setup();
    const history: HistoryItem[] = [
      { query: "speak", kind: "latin", at: 1 },
      { query: "ရေ", kind: "burmese", at: 2 },
    ];
    window.localStorage.setItem(
      "myangler.history.v1",
      JSON.stringify(history),
    );
    const engine = await buildAppEngine();
    render(
      <EngineProvider engine={engine}>
        <AppShell initialTab="history" />
      </EngineProvider>,
    );
    await waitFor(() => screen.getByTestId("history-view"));
    await user.click(screen.getByRole("button", { name: /clear history/i }));
    expect(screen.getByTestId("history-empty")).toBeInTheDocument();
  });
});

describe("AppShell · favorites navigation", () => {
  test("clicking a saved entry opens it and goes back to the search tab", async () => {
    const user = userEvent.setup();
    const favorites: FavoriteItem[] = [
      {
        entryId: 2,
        headword: "ပြော",
        pos: "verb",
        glosses: ["speak"],
        ipa: null,
        at: 1,
      },
    ];
    window.localStorage.setItem(
      "myangler.favorites.v1",
      JSON.stringify(favorites),
    );
    const engine = await buildAppEngine();
    render(
      <EngineProvider engine={engine}>
        <AppShell initialTab="fav" />
      </EngineProvider>,
    );

    await waitFor(() => screen.getByTestId("favorites-view"));
    await user.click(screen.getByTestId("favorite-item-0"));
    expect(
      (await screen.findAllByTestId("entry-headword"))[0],
    ).toHaveTextContent("ပြော");
  });
});

describe("AppShell · shareable URL", () => {
  test("mounting with ?q=… seeds the search input and shows results", async () => {
    window.history.replaceState({}, "", "/?q=speak");
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("speak"));
    await waitFor(() =>
      expect(screen.getByTestId("results-view")).toBeInTheDocument(),
    );
  });

  test("typing updates window.location.search via replaceState", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() =>
      expect(window.location.search).toBe("?q=speak"),
    );
  });

  test("clearing the input removes the q parameter from the URL", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => expect(window.location.search).toBe("?q=speak"));
    await user.clear(input);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  test("the per-query share button copies the share URL and shows a toast", async () => {
    const user = userEvent.setup();
    // userEvent installs a virtual clipboard on navigator.clipboard;
    // spy on its writeText so we can assert the URL the handler copies.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");

    const shareBtn = await screen.findByTestId("share-query");
    await user.click(shareBtn);

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toContain("?q=speak");
    expect(url.startsWith(window.location.origin)).toBe(true);

    expect(await screen.findByRole("status")).toHaveTextContent(/link copied/i);
  });

  test("the share button is present but disabled when the query is empty", async () => {
    // Kept mounted (disabled) so the input doesn't jump when typing starts.
    await renderWithEngine(<AppShell />);
    expect(screen.getByTestId("share-query")).toBeDisabled();
  });

  test("Copy all copies a text rendering of the current results and toasts", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => screen.getByTestId("results-view"));

    await user.click(await screen.findByTestId("copy-all"));

    expect(writeText).toHaveBeenCalledTimes(1);
    // ပြော → "speak" is in the fixture; the copied text lists it.
    expect(writeText.mock.calls[0][0] as string).toContain("ပြော");
    expect(await screen.findByRole("status")).toHaveTextContent(/copied/i);
  });

  test("Copy all is present but disabled when the query is empty", async () => {
    await renderWithEngine(<AppShell />);
    expect(screen.getByTestId("copy-all")).toBeDisabled();
  });

  test("the EntryDetail share button copies a URL whose q is the entry headword", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "speak");
    await waitFor(() => inResults("ပြော"));
    await user.click(inResults("ပြော"));

    // Mobile sheet + desktop rail both render in jsdom — click the first
    // "Share" button. The per-query share button is also on screen but
    // has aria-label "Share search", so the /^share$/i name matches only
    // the EntryDetail one.
    const shareButtons = await screen.findAllByRole("button", { name: /^share$/i });
    await user.click(shareButtons[0]);

    expect(writeText).toHaveBeenCalled();
    const url = writeText.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain("?q=");
    expect(decodeURIComponent(url)).toContain("ပြော");
  });
});

describe("AppShell · install-to-home-screen guide", () => {
  // `Object.defineProperty(window.navigator, "userAgent", …)` persists
  // between tests, so capture the original UA descriptor up front and
  // restore it in afterEach — otherwise the first iPhone-UA test would
  // leak into every subsequent test in this whole file.
  const originalUA = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(window.navigator),
    "userAgent",
  );

  afterEach(() => {
    clearMatchMedia();
    if (originalUA) {
      Object.defineProperty(window.navigator, "userAgent", originalUA);
    }
    vi.restoreAllMocks();
  });

  async function renderShell() {
    clearAllStorage();
    const engine = await buildAppEngine();
    return render(
      <EngineProvider engine={engine}>
        <AppShell />
      </EngineProvider>,
    );
  }

  test("the guide does NOT auto-open on mobile — user must tap the header button", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(() => false);
    await renderShell();
    expect(
      screen.queryByRole("dialog", { name: /install myangler/i }),
    ).not.toBeInTheDocument();
  });

  test("on mobile, the header shows an Install button in place of the ornament", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(() => false);
    await renderShell();
    expect(screen.getByTestId("header-install")).toBeInTheDocument();
    expect(screen.queryByTestId("header-ornament")).not.toBeInTheDocument();
  });

  test("tapping the header Install button opens the install guide", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(() => false);
    const user = userEvent.setup();
    await renderShell();
    expect(
      screen.queryByRole("dialog", { name: /install myangler/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("header-install"));
    expect(
      await screen.findByRole("dialog", { name: /install myangler/i }),
    ).toBeInTheDocument();
  });

  test("clicking outside the install guide dismisses it — even on chrome that lives outside the sheet's positioned parent", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(() => false);
    const user = userEvent.setup();
    await renderShell();

    await user.click(screen.getByTestId("header-install"));
    await screen.findByRole("dialog", { name: /install myangler/i });

    // The mobile Wordmark lives in the page header — completely outside
    // the Sheet's relatively-positioned parent. The old scrim-button
    // approach couldn't reach it; the document-level mousedown handler
    // can. Click it and the guide should dismiss.
    const wordmarks = screen.getAllByRole("link", { name: /myangler/i });
    await user.click(wordmarks[0]);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /install myangler/i }),
      ).not.toBeInTheDocument(),
    );
  });

  test("closing the guide hides it but leaves the header button in place for re-opening", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(() => false);
    const user = userEvent.setup();
    await renderShell();

    await user.click(screen.getByTestId("header-install"));
    const dialog = await screen.findByRole("dialog", {
      name: /install myangler/i,
    });
    await user.click(within(dialog).getByTestId("install-guide-done"));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /install myangler/i }),
      ).not.toBeInTheDocument(),
    );

    expect(screen.getByTestId("header-install")).toBeInTheDocument();
    // And it works a second time.
    await user.click(screen.getByTestId("header-install"));
    expect(
      await screen.findByRole("dialog", { name: /install myangler/i }),
    ).toBeInTheDocument();
  });

  test("in the installed PWA (standalone display), the header keeps the ornament and no Install button is shown", async () => {
    stubUA(IPHONE_UA);
    stubMatchMedia(q => q === "(display-mode: standalone)");
    await renderShell();
    expect(screen.queryByTestId("header-install")).not.toBeInTheDocument();
    expect(screen.getByTestId("header-ornament")).toBeInTheDocument();
  });

  test("on a desktop UA, the mobile header (when produced in jsdom) keeps the ornament — no Install button", async () => {
    // jsdom default UA → `platform === "other"` → install unavailable.
    stubMatchMedia(() => false);
    await renderShell();
    expect(screen.queryByTestId("header-install")).not.toBeInTheDocument();
    expect(screen.getByTestId("header-ornament")).toBeInTheDocument();
  });
});
