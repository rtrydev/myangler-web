import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "./Chip";

describe("Chip", () => {
  test("renders its children", () => {
    render(<Chip>thank you</Chip>);
    expect(screen.getByText("thank you")).toBeInTheDocument();
  });

  test("applies the base chip class on every variant", () => {
    const { rerender, container } = render(<Chip>x</Chip>);
    expect(container.firstChild).toHaveClass("chip");

    rerender(<Chip variant="exact">x</Chip>);
    expect(container.firstChild).toHaveClass("chip", "tag-exact");
  });

  test("variant changes the visible style class", () => {
    const variants = [
      ["solid", "chip-solid"],
      ["exact", "tag-exact"],
      ["partial", "tag-partial"],
      ["fuzzy", "tag-fuzzy"],
    ] as const;

    for (const [variant, klass] of variants) {
      const { container, unmount } = render(<Chip variant={variant}>x</Chip>);
      expect(container.firstChild).toHaveClass(klass);
      unmount();
    }
  });

  test("default variant has no variant-specific class", () => {
    const { container } = render(<Chip>x</Chip>);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("chip");
    expect(el).not.toHaveClass("chip-solid", "tag-exact", "tag-partial", "tag-fuzzy");
  });

  test("forwards extra className and data attributes", () => {
    render(<Chip className="extra" data-testid="my-chip">label</Chip>);
    const el = screen.getByTestId("my-chip");
    expect(el).toHaveClass("chip", "extra");
  });
});
