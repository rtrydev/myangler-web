import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entry } from "@/app/lib/lookup";
import { WordOfTheDay } from "./WordOfTheDay";

const entry: Entry = {
  entryId: 42,
  headword: "ရေ",
  pos: "noun",
  glosses: ["water", "liquid"],
  normalizedGlosses: ["water", "liquid"],
  ipa: "jè",
};

describe("WordOfTheDay", () => {
  test("renders the featured eyebrow, headword, POS, and senses", () => {
    render(<WordOfTheDay entry={entry} />);
    expect(screen.getByText(/word of the day/i)).toBeInTheDocument();
    expect(screen.getByText("ရေ")).toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(screen.getByText("water")).toBeInTheDocument();
    expect(screen.getByText("liquid")).toBeInTheDocument();
  });

  test("the CTA calls onOpen with the entry", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<WordOfTheDay entry={entry} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /see full entry/i }));
    expect(onOpen).toHaveBeenCalledWith(entry);
  });

  test("caps the previewed senses and notes how many more there are", () => {
    const many: Entry = {
      ...entry,
      glosses: ["one", "two", "three", "four", "five", "six", "seven"],
      normalizedGlosses: [],
    };
    render(<WordOfTheDay entry={many} />);
    // First five render; the rest are summarized.
    expect(screen.getByText("five")).toBeInTheDocument();
    expect(screen.queryByText("six")).not.toBeInTheDocument();
    expect(screen.getByText(/\+2 more senses/i)).toBeInTheDocument();
  });
});
