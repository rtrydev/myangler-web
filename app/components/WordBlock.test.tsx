import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WordBlock } from "./WordBlock";

describe("WordBlock", () => {
  test("renders both Burmese and English text", () => {
    render(<WordBlock mm="ဒီနေ့" en="today" />);
    expect(screen.getByText("ဒီနေ့")).toBeInTheDocument();
    expect(screen.getByText("today")).toBeInTheDocument();
  });

  test("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<WordBlock mm="ဒီနေ့" en="today" onClick={onClick} data-testid="wb" />);

    await user.click(screen.getByTestId("wb"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("the selected state applies the selected class", () => {
    render(<WordBlock mm="ဒီနေ့" en="today" selected data-testid="wb" />);
    expect(screen.getByTestId("wb")).toHaveClass("wblock", "selected");
  });

  test("the unknown state applies the unknown class", () => {
    render(<WordBlock mm="??" en="unknown" unknown data-testid="wb" />);
    expect(screen.getByTestId("wb")).toHaveClass("wblock", "unknown");
  });

  test("default state has neither selected nor unknown class", () => {
    render(<WordBlock mm="ဒီနေ့" en="today" data-testid="wb" />);
    const el = screen.getByTestId("wb");
    expect(el).toHaveClass("wblock");
    expect(el).not.toHaveClass("selected");
    expect(el).not.toHaveClass("unknown");
  });

  test("longer Burmese strings get a smaller font size than short ones", () => {
    // Threshold is mm.length > 4 in JS code-unit length.
    render(<WordBlock mm="ရာသီဥတု" en="weather" data-testid="long" />);
    render(<WordBlock mm="ရေ" en="water" data-testid="short" />);

    const longMm = screen.getByText("ရာသီဥတု");
    const shortMm = screen.getByText("ရေ");
    expect(longMm.style.fontSize).toBe("17px");
    expect(shortMm.style.fontSize).toBe("20px");
  });
});
