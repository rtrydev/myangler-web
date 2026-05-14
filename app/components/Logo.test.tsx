import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo, Wordmark } from "./Logo";

describe("Logo", () => {
  test("renders an image with the Myangler accessible name", () => {
    render(<Logo />);
    const img = screen.getByRole("img", { name: /myangler/i });
    expect(img).toBeInTheDocument();
  });

  test("size prop controls rendered width and height", () => {
    render(<Logo size={48} />);
    const img = screen.getByRole("img", { name: /myangler/i }) as HTMLImageElement;
    // next/image renders a real <img> in tests; width/height are forwarded.
    expect(img).toHaveAttribute("width", "48");
    expect(img).toHaveAttribute("height", "48");
  });
});

describe("Wordmark", () => {
  test("renders the brand name and a logo image together", () => {
    render(<Wordmark />);
    expect(screen.getByText("Myangler")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /myangler/i })).toBeInTheDocument();
  });

  test("scale prop is applied to the logo size", () => {
    render(<Wordmark scale={2} />);
    const img = screen.getByRole("img", { name: /myangler/i });
    // base logo size is 26 * scale
    expect(img).toHaveAttribute("width", "52");
    expect(img).toHaveAttribute("height", "52");
  });
});
