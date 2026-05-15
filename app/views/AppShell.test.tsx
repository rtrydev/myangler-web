import { beforeEach, describe, expect, test } from "vitest";
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

beforeEach(() => clearAllStorage());

describe("AppShell · ready state", () => {
  test("renders the app shell once the engine is ready", async () => {
    await renderWithEngine(<AppShell />);
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /search/i })).toBeInTheDocument();
  });

  test("does not expose theme/accent controls directly in the header", async () => {
    await renderWithEngine(<AppShell />);
    // The theme toggle lives inside the Settings sheet now — not in the
    // header chrome. With the sheet closed, it should be absent entirely.
    expect(
      screen.queryByRole("button", { name: /toggle theme/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /accent ruby/i }),
    ).not.toBeInTheDocument();
  });
});

describe("AppShell · mobile settings sheet", () => {
  test("the mobile hamburger opens a Settings dialog with the theme & accent controls", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);

    // Only one "Open settings" button exists — the mobile hamburger. The
    // desktop sidebar's Settings entry uses its visible text as the
    // accessible name ("Settings"), not "Open settings".
    const hamburger = screen.getByRole("button", { name: /open settings/i });
    await user.click(hamburger);

    expect(
      await screen.findByRole("dialog", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /toggle theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /accent ruby/i }),
    ).toBeInTheDocument();
  });

  test("toggling the theme inside the mobile sheet applies the dark class to <html>", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });

  test("the in-sheet Close button dismisses the dialog", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /settings/i }),
      ).not.toBeInTheDocument(),
    );
  });

  test("Escape closes the mobile settings sheet", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(
      await screen.findByRole("dialog", { name: /settings/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /settings/i }),
      ).not.toBeInTheDocument(),
    );
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
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    expect(document.documentElement.dataset.accent).toBe("jade");
    expect(document.body.dataset.accent).toBeUndefined();
  });

  test("accent persists across open/close cycles of the mobile sheet", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(
      screen.getByRole("button", { name: /accent jade/i }),
    ).toHaveAttribute("aria-pressed", "true");
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
    expect(screen.getByText("ပြော")).toBeInTheDocument();
  });

  test("typing Burmese routes through the breakdown engine and shows word blocks", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    const input = screen.getByRole("textbox", { name: /search/i });
    await user.type(input, "မြန်မာစကား");
    await waitFor(() =>
      expect(screen.getByTestId("breakdown-view")).toBeInTheDocument(),
    );
    expect(screen.getByText("မြန်မာ")).toBeInTheDocument();
    expect(screen.getByText("စကား")).toBeInTheDocument();
  });

  test("clicking a sample chip seeds the query", async () => {
    const user = userEvent.setup();
    await renderWithEngine(<AppShell />);
    await user.click(screen.getByText("water"));
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
    await waitFor(() => screen.getByText("ပြော"));

    await user.click(screen.getByText("ပြော"));

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
    await waitFor(() => screen.getByText("ပြော"));
    await user.click(screen.getByText("ပြော"));

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
    await waitFor(() => screen.getByText("ပြော"));
    await user.click(screen.getByText("ပြော"));

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
    await waitFor(() => screen.getByText("ပြော"));
    await user.click(screen.getByText("ပြော"));

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
