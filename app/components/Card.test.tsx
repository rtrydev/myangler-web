import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, Note } from "./Card";

describe("Card", () => {
  test("renders its children", () => {
    render(
      <Card>
        <p>card body</p>
      </Card>
    );
    expect(screen.getByText("card body")).toBeInTheDocument();
  });

  test("applies the base card class and merges extra className", () => {
    const { container } = render(<Card className="extra">x</Card>);
    expect(container.firstChild).toHaveClass("card", "extra");
  });

  test("forwards data attributes", () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });
});

describe("Note", () => {
  test("renders the default label and the message text", () => {
    render(<Note>be careful</Note>);
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("be careful")).toBeInTheDocument();
  });

  test("accepts a custom label", () => {
    render(<Note label="About splitting">we split words</Note>);
    expect(screen.getByText("About splitting")).toBeInTheDocument();
    expect(screen.queryByText("Note")).not.toBeInTheDocument();
  });

  test("forwards data attributes onto the wrapper", () => {
    render(
      <Note data-testid="note" label="hi">
        body
      </Note>
    );
    expect(screen.getByTestId("note")).toContainElement(screen.getByText("body"));
  });
});
