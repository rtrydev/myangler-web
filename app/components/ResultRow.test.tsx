import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultRow } from "./ResultRow";

describe("ResultRow", () => {
  test("renders the Burmese word, English gloss, and meaning", () => {
    render(
      <ResultRow
        mm="ရေချိုး"
        en="to bathe"
        meaning="lit. wash with water"
        tag="partial"
      />
    );
    expect(screen.getByText("ရေချိုး")).toBeInTheDocument();
    expect(screen.getByText("to bathe")).toBeInTheDocument();
    expect(screen.getByText("lit. wash with water")).toBeInTheDocument();
  });

  test("renders each entry in a group, separated by middots", () => {
    render(
      <ResultRow
        group={["ရေသန့်", "သောက်ရေ"]}
        en="drinking water"
        meaning="purified water"
        tag="exact"
      />
    );
    expect(screen.getByText("ရေသန့်")).toBeInTheDocument();
    expect(screen.getByText("သောက်ရေ")).toBeInTheDocument();
    expect(screen.getByText("·")).toBeInTheDocument();
  });

  test("shows the note text when provided", () => {
    render(
      <ResultRow
        mm="ဝတ်"
        en="to wear"
        note="did you mean ‘wear’?"
        tag="fuzzy"
      />
    );
    expect(screen.getByText(/did you mean/)).toBeInTheDocument();
  });

  test("hides meaning and note when not provided", () => {
    const { container } = render(<ResultRow mm="ရေ" en="water" tag="exact" />);
    // Only mm + en + chip label should appear — no extra body lines.
    expect(container.textContent).toBe("ရေwaterexact");
  });

  test.each([
    ["exact", "exact"],
    ["partial", "partial"],
    ["fuzzy", "close"],
  ] as const)("tag %s renders the chip with label %s", (tag, label) => {
    render(<ResultRow mm="ရေ" en="water" tag={tag} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(label)).toHaveClass("chip", `tag-${tag}`);
  });

  test("fires onClick when activated", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ResultRow
        mm="ရေ"
        en="water"
        tag="exact"
        onClick={onClick}
        data-testid="row"
      />
    );
    await user.click(screen.getByTestId("row"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
