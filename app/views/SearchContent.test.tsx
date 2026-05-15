import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entry } from "@/app/lib/lookup";
import type { ResultRow, SearchResult } from "@/app/lib/search";
import { SearchContent } from "./SearchContent";

const sampleEntry: Entry = {
  entryId: 1,
  headword: "ရေ",
  pos: "noun",
  glosses: ["water"],
  normalizedGlosses: ["water"],
  ipa: null,
};
const peerEntry: Entry = {
  entryId: 2,
  headword: "ရေချိုး",
  pos: "verb",
  glosses: ["to bathe"],
  normalizedGlosses: ["bathe"],
  ipa: null,
};

const empty: SearchResult = { kind: "empty" };
const unrecognized: SearchResult = { kind: "unrecognized" };
const tooLong: SearchResult = { kind: "too_long", limit: 100, length: 250 };

const breakdown: SearchResult = {
  kind: "breakdown",
  mixedInput: false,
  tokens: [
    { token: "ရေ", result: { entry: sampleEntry, mergedPeers: [] } },
    { token: " ", result: null },
    { token: "ရေချိုး", result: { entry: peerEntry, mergedPeers: [] } },
    { token: "ဥ", result: null },
  ],
};

const exactRow: ResultRow = {
  tier: 0,
  fuzzy: false,
  distance: 0,
  key: "water",
  entries: [sampleEntry],
};
const partialRow: ResultRow = {
  tier: 1,
  fuzzy: false,
  distance: 0,
  key: "bathe",
  entries: [peerEntry],
};
const fuzzyRow: ResultRow = {
  tier: 3,
  fuzzy: true,
  distance: 1,
  key: "wear",
  entries: [
    {
      entryId: 9,
      headword: "ဝတ်",
      pos: "verb",
      glosses: ["to wear"],
      normalizedGlosses: ["wear"],
      ipa: null,
    },
  ],
};
const reverse: SearchResult = {
  kind: "reverse",
  rows: [exactRow, partialRow, fuzzyRow],
};

describe("SearchContent · idle", () => {
  test("empty result shows the idle hero, the 'How to use' steps, and sample chips", () => {
    render(<SearchContent result={empty} />);
    expect(screen.getByTestId("idle-view")).toBeInTheDocument();
    expect(screen.getByText(/pocket dictionary/i)).toBeInTheDocument();
    expect(screen.getByText("How to use")).toBeInTheDocument();
    expect(screen.getByText(/Type any word/i)).toBeInTheDocument();
    expect(screen.getByText("water")).toBeInTheDocument();
  });

  test("unrecognized result still shows the idle view", () => {
    render(<SearchContent result={unrecognized} />);
    expect(screen.getByTestId("idle-view")).toBeInTheDocument();
  });

  test("clicking a sample chip fires onChip with the chip's text", async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    render(<SearchContent result={empty} onChip={onChip} />);
    await user.click(screen.getByText("water"));
    expect(onChip).toHaveBeenCalledWith("water");
  });

  test("renders the total-entries pill when totalEntries is supplied", () => {
    render(<SearchContent result={empty} totalEntries={1234} />);
    expect(screen.getByText(/1,234 entries/)).toBeInTheDocument();
  });
});

describe("SearchContent · too long", () => {
  test("renders the cap and the user's measured length", () => {
    render(<SearchContent result={tooLong} />);
    expect(screen.getByTestId("too-long-view")).toBeInTheDocument();
    expect(screen.getByText(/250-character input/)).toBeInTheDocument();
    expect(screen.getByText(/100-character limit/)).toBeInTheDocument();
  });
});

describe("SearchContent · breakdown", () => {
  test("shows one word block per token, including unknown ones", () => {
    render(<SearchContent result={breakdown} />);
    expect(screen.getByTestId("breakdown-view")).toBeInTheDocument();
    expect(screen.getByText("ရေ")).toBeInTheDocument();
    expect(screen.getByText("ရေချိုး")).toBeInTheDocument();
    // Unknown tokens still render their text + a placeholder gloss.
    expect(screen.getByText("ဥ")).toBeInTheDocument();
  });

  test("counts only resolvable tokens (results !== null) in the header", () => {
    render(<SearchContent result={breakdown} />);
    expect(screen.getByText(/2 words/)).toBeInTheDocument();
  });

  test("clicking a known block fires onSelectToken with that token", async () => {
    const user = userEvent.setup();
    const onSelectToken = vi.fn();
    render(<SearchContent result={breakdown} onSelectToken={onSelectToken} />);
    await user.click(screen.getByText("ရေ").closest(".wblock")!);
    expect(onSelectToken).toHaveBeenCalledTimes(1);
    expect(onSelectToken.mock.calls[0][0].token).toBe("ရေ");
  });

  test("clicking an unknown block does not fire onSelectToken", async () => {
    const user = userEvent.setup();
    const onSelectToken = vi.fn();
    render(<SearchContent result={breakdown} onSelectToken={onSelectToken} />);
    await user.click(screen.getByText("ဥ").closest(".wblock")!);
    expect(onSelectToken).not.toHaveBeenCalled();
  });

  test("marks the currently-selected token via the selectedEntryId prop", () => {
    render(<SearchContent result={breakdown} selectedEntryId={1} />);
    const block = screen.getByText("ရေ").closest(".wblock");
    expect(block).toHaveClass("selected");
  });
});

describe("SearchContent · results", () => {
  test("renders one row per result and tags them with the right chip", () => {
    render(<SearchContent result={reverse} />);
    expect(screen.getByTestId("results-view")).toBeInTheDocument();
    expect(screen.getByText("3 results · English → မြန်မာ")).toBeInTheDocument();
    expect(screen.getByText("exact")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText("close")).toBeInTheDocument();
  });

  test("clicking a row fires onSelectRow with the row's first entry", async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    render(<SearchContent result={reverse} onSelectRow={onSelectRow} />);
    await user.click(screen.getByTestId(`result-row-${sampleEntry.entryId}`));
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect(onSelectRow.mock.calls[0][0]).toBe(sampleEntry);
    expect(onSelectRow.mock.calls[0][1]).toBe(exactRow);
  });

  test("Enter activates a row via the keyboard", async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    render(<SearchContent result={reverse} onSelectRow={onSelectRow} />);
    const row = screen.getByTestId(`result-row-${sampleEntry.entryId}`);
    row.focus();
    await user.keyboard("{Enter}");
    expect(onSelectRow).toHaveBeenCalledOnce();
  });

  test("empty reverse result shows the no-matches view", () => {
    render(<SearchContent result={{ kind: "reverse", rows: [] }} />);
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
    expect(screen.getByText(/couldn.?t find anything/i)).toBeInTheDocument();
  });

  test("groups multiple entries under one row when they share a key", () => {
    const groupedRow: ResultRow = {
      tier: 0,
      fuzzy: false,
      distance: 0,
      key: "water",
      entries: [
        {
          entryId: 100,
          headword: "ရေသန့်",
          pos: "noun",
          glosses: ["drinking water"],
          normalizedGlosses: ["drinking water"],
          ipa: null,
        },
        {
          entryId: 101,
          headword: "သောက်ရေ",
          pos: "noun",
          glosses: ["drinking water"],
          normalizedGlosses: ["drinking water"],
          ipa: null,
        },
      ],
    };
    render(<SearchContent result={{ kind: "reverse", rows: [groupedRow] }} />);
    const row = screen.getByTestId(`result-row-${groupedRow.entries[0].entryId}`);
    expect(within(row).getByText("ရေသန့်")).toBeInTheDocument();
    expect(within(row).getByText("သောက်ရေ")).toBeInTheDocument();
  });
});
