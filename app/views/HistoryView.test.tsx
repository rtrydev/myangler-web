import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HistoryItem } from "@/app/lib/app/types";
import { HistoryView, relativeTime } from "./HistoryView";

const now = 1_700_000_000_000;

const items: HistoryItem[] = [
  { query: "ဒီနေ့ ရာသီဥတု အေးတယ်", kind: "burmese", at: now - 30_000 }, // 30 sec ago
  { query: "ရေ", kind: "burmese", at: now - 4 * 60 * 1000 }, // 4 min ago
  { query: "water", kind: "latin", at: now - 3 * 60 * 60 * 1000 }, // 3 hr
];

describe("HistoryView", () => {
  test("renders one row per history item with its query text", () => {
    render(<HistoryView items={items} />);
    expect(screen.getByText("ဒီနေ့ ရာသီဥတု အေးတယ်")).toBeInTheDocument();
    expect(screen.getByText("ရေ")).toBeInTheDocument();
    expect(screen.getByText("water")).toBeInTheDocument();
  });

  test("tags multi-word entries with a 'sentence' chip", () => {
    render(<HistoryView items={items} />);
    // Multi-word query shows both a 'sentence' description and a 'sentence' chip.
    const matches = screen.getAllByText("sentence");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("clicking a row fires onSelect with the underlying item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HistoryView items={items} onSelect={onSelect} />);
    await user.click(screen.getByTestId("history-item-1"));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  test("clear button only appears when there are items AND onClear is provided", () => {
    const onClear = vi.fn();
    const { rerender } = render(<HistoryView items={items} onClear={onClear} />);
    expect(screen.getByRole("button", { name: /clear history/i })).toBeInTheDocument();

    rerender(<HistoryView items={[]} onClear={onClear} />);
    expect(
      screen.queryByRole("button", { name: /clear history/i }),
    ).not.toBeInTheDocument();

    rerender(<HistoryView items={items} />);
    expect(
      screen.queryByRole("button", { name: /clear history/i }),
    ).not.toBeInTheDocument();
  });

  test("clear button fires onClear when clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<HistoryView items={items} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: /clear history/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  test("empty state appears when there are no items", () => {
    render(<HistoryView items={[]} />);
    expect(screen.getByTestId("history-empty")).toBeInTheDocument();
    expect(screen.getByText(/Words and sentences/)).toBeInTheDocument();
  });
});

describe("relativeTime", () => {
  test("returns 'just now' for sub-minute ages", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  test("returns minutes for sub-hour ages", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min");
  });

  test("returns hours for sub-day ages", () => {
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe("3 hr");
  });

  test("returns 'yesterday' for ~1-day-old ages", () => {
    expect(relativeTime(now - 25 * 60 * 60_000, now)).toBe("yesterday");
  });

  test("returns multi-day ages for older items", () => {
    expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3 days");
  });
});
