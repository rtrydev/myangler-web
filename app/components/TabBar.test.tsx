import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar, type TabItem } from "./TabBar";

const items: TabItem[] = [
  { id: "search", label: "Look up", icon: () => <span data-testid="i-search">s</span> },
  { id: "history", label: "History", icon: () => <span data-testid="i-history">h</span> },
  { id: "fav", label: "Saved", icon: () => <span data-testid="i-fav">f</span> },
];

describe("TabBar", () => {
  test("renders every item as a button with its label as accessible name", () => {
    render(<TabBar items={items} active="search" />);
    for (const it of items) {
      expect(screen.getByRole("button", { name: new RegExp(it.label, "i") })).toBeInTheDocument();
    }
  });

  test("the active tab is visually marked with the gold class", () => {
    render(<TabBar items={items} active="history" />);
    const history = screen.getByRole("button", { name: /history/i });
    const search = screen.getByRole("button", { name: /look up/i });
    expect(history).toHaveClass("text-gold");
    expect(search).not.toHaveClass("text-gold");
  });

  test("clicking a tab calls onChange with its id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar items={items} active="search" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /history/i }));
    expect(onChange).toHaveBeenCalledWith("history");

    await user.click(screen.getByRole("button", { name: /saved/i }));
    expect(onChange).toHaveBeenCalledWith("fav");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("clicking a tab without onChange does not throw", async () => {
    const user = userEvent.setup();
    render(<TabBar items={items} active="search" />);
    await user.click(screen.getByRole("button", { name: /history/i }));
    // No assertion needed: absence of an error is the contract.
  });

  test("tabs are reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<TabBar items={items} active="search" />);

    await user.tab();
    expect(screen.getByRole("button", { name: /look up/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /history/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /saved/i })).toHaveFocus();
  });

  test("Enter activates the focused tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar items={items} active="search" onChange={onChange} />);

    await user.tab();
    await user.tab(); // focus 'history'
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("history");
  });
});
