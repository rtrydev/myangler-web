import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Ornament, RuleGold, Eyebrow, Flourish } from "./Ornament";

describe("Ornament", () => {
  test("renders with the ornament class", () => {
    const { container } = render(<Ornament />);
    expect(container.firstChild).toHaveClass("ornament");
  });

  test("merges an extra className", () => {
    const { container } = render(<Ornament className="extra" />);
    expect(container.firstChild).toHaveClass("ornament", "extra");
  });
});

describe("RuleGold", () => {
  test("renders with the rule-gold class", () => {
    const { container } = render(<RuleGold />);
    expect(container.firstChild).toHaveClass("rule-gold");
  });
});

describe("Flourish", () => {
  test("renders an svg with proportional default dimensions", () => {
    const { container } = render(<Flourish />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("width", "72");
    expect(svg).toHaveAttribute("height", "18");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  test("scales height proportionally when width is overridden", () => {
    const { container } = render(<Flourish width={144} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "144");
    expect(svg).toHaveAttribute("height", "36");
  });

  test("composes additional className with the gold default", () => {
    const { container } = render(<Flourish className="extra" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-gold", "opacity-70", "extra");
  });
});

describe("Eyebrow", () => {
  test("renders its label text", () => {
    render(<Eyebrow>How to use</Eyebrow>);
    expect(screen.getByText("How to use")).toBeInTheDocument();
  });

  test("applies the gold modifier when gold is true", () => {
    render(<Eyebrow gold>Note</Eyebrow>);
    expect(screen.getByText("Note")).toHaveClass("eyebrow", "eyebrow-gold");
  });

  test("does not apply the gold modifier by default", () => {
    render(<Eyebrow>Note</Eyebrow>);
    const el = screen.getByText("Note");
    expect(el).toHaveClass("eyebrow");
    expect(el).not.toHaveClass("eyebrow-gold");
  });

  test("renders a gold rule beside the label when withRule is true", () => {
    const { container } = render(<Eyebrow withRule>Recent</Eyebrow>);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(container.querySelector(".rule-gold")).not.toBeNull();
  });

  test("does not render a rule when withRule is false", () => {
    const { container } = render(<Eyebrow>Recent</Eyebrow>);
    expect(container.querySelector(".rule-gold")).toBeNull();
  });
});
