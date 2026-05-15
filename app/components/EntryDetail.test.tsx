import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entry } from "@/app/lib/lookup";
import { EntryDetail } from "./EntryDetail";

const entry: Entry = {
  entryId: 10,
  headword: "ရေ",
  pos: "noun",
  glosses: ["water", "liquid"],
  normalizedGlosses: ["water", "liquid"],
  ipa: "jè",
};

const peer: Entry = {
  entryId: 11,
  headword: "ရေချိုး",
  pos: "verb",
  glosses: ["to bathe"],
  normalizedGlosses: ["bathe"],
  ipa: null,
};

describe("EntryDetail", () => {
  test("renders the headword, POS, IPA, and each gloss as a numbered meaning", () => {
    render(<EntryDetail entry={entry} />);
    expect(screen.getByTestId("entry-headword")).toHaveTextContent("ရေ");
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(screen.getByText("/jè/")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /meanings/i });
    expect(within(list).getByText("water")).toBeInTheDocument();
    expect(within(list).getByText("liquid")).toBeInTheDocument();
    expect(within(list).getByText("1.")).toBeInTheDocument();
    expect(within(list).getByText("2.")).toBeInTheDocument();
  });

  test("omits the IPA fragment when entry.ipa is null", () => {
    render(<EntryDetail entry={{ ...entry, ipa: null }} />);
    expect(screen.queryByText(/\/.*\//)).not.toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();
  });

  test("Save button toggles label between Save and Saved based on `saved` prop", () => {
    const { rerender } = render(<EntryDetail entry={entry} saved={false} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    rerender(<EntryDetail entry={entry} saved={true} />);
    expect(screen.getByRole("button", { name: /saved/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("clicking Save fires onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EntryDetail entry={entry} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  test("hides the close button when onClose is not supplied", () => {
    render(<EntryDetail entry={entry} />);
    expect(
      screen.queryByRole("button", { name: /close entry/i }),
    ).not.toBeInTheDocument();
  });

  test("shows the close button when onClose is supplied and fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EntryDetail entry={entry} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close entry/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("renders related entries under Forms and fires onSelectRelated on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <EntryDetail entry={entry} related={[peer]} onSelectRelated={onSelect} />,
    );
    const formsBtn = screen.getByRole("button", { name: /ရေချိုး/ });
    expect(formsBtn).toBeInTheDocument();
    expect(screen.getByText("to bathe")).toBeInTheDocument();
    await user.click(formsBtn);
    expect(onSelect).toHaveBeenCalledWith(peer);
  });

  test("disables auxiliary actions when their callbacks aren't provided", () => {
    render(<EntryDetail entry={entry} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /share/i })).toBeDisabled();
  });

  test("does not render a pronounce/read-aloud button", () => {
    render(<EntryDetail entry={entry} />);
    expect(
      screen.queryByRole("button", { name: /pronounce/i }),
    ).not.toBeInTheDocument();
  });

  test("clicking Copy fires onCopy", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<EntryDetail entry={entry} onCopy={onCopy} />);
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
