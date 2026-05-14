import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Ornament, RuleGold, Eyebrow } from "./Ornament";

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
