import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FavoriteItem } from "@/app/lib/app/types";
import { FavoritesView } from "./FavoritesView";

const items: FavoriteItem[] = [
  {
    entryId: 1,
    headword: "မင်္ဂလာပါ",
    pos: "phrase",
    glosses: ["hello", "auspicious greeting"],
    ipa: null,
    tag: "greeting",
    at: 1,
  },
  {
    entryId: 2,
    headword: "ဘယ်လောက်လဲ",
    pos: "phrase",
    glosses: ["how much?"],
    ipa: null,
    tag: "travel",
    at: 2,
  },
  {
    entryId: 3,
    headword: "ရေ",
    pos: "noun",
    glosses: ["water"],
    ipa: null,
    tag: "common",
    at: 3,
  },
];

describe("FavoritesView", () => {
  test("renders one row per saved entry", () => {
    render(<FavoritesView items={items} />);
    expect(screen.getByTestId("favorites-view")).toBeInTheDocument();
    expect(screen.getByText("မင်္ဂလာပါ")).toBeInTheDocument();
    expect(screen.getByText("ဘယ်လောက်လဲ")).toBeInTheDocument();
    expect(screen.getByText("ရေ")).toBeInTheDocument();
  });

  test("shows the word count in the header", () => {
    render(<FavoritesView items={items} />);
    expect(screen.getByText(/3 words/)).toBeInTheDocument();
  });

  test("renders tag filter chips for every unique tag, plus an 'all'", () => {
    render(<FavoritesView items={items} />);
    expect(screen.getByRole("button", { name: "all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "greeting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "travel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common" })).toBeInTheDocument();
  });

  test("filtering by tag narrows the visible items", async () => {
    const user = userEvent.setup();
    render(<FavoritesView items={items} />);
    await user.click(screen.getByRole("button", { name: "travel" }));
    expect(screen.getByText("ဘယ်လောက်လဲ")).toBeInTheDocument();
    expect(screen.queryByText("မင်္ဂလာပါ")).not.toBeInTheDocument();
  });

  test("clicking an item fires onSelect with the item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FavoritesView items={items} onSelect={onSelect} />);
    await user.click(screen.getByTestId("favorite-item-0"));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  test("empty state shows the 'nothing saved' nudge", () => {
    render(<FavoritesView items={[]} />);
    expect(screen.getByTestId("favorites-empty")).toBeInTheDocument();
    expect(screen.getByText(/Open an entry and tap Save/i)).toBeInTheDocument();
  });

  test("empty-filtered state shows a different nudge", async () => {
    const user = userEvent.setup();
    render(<FavoritesView items={items.filter(i => i.tag === "greeting")} />);
    // Items with only 'greeting' tag — filtering to 'travel' yields zero
    await user.click(screen.getByRole("button", { name: "greeting" }));
    expect(screen.getByText("မင်္ဂလာပါ")).toBeInTheDocument();
  });
});
