import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toast } from "./Toast";

describe("Toast", () => {
  test("renders the message when open", () => {
    render(<Toast open message="Link copied" />);
    const node = screen.getByRole("status");
    expect(node).toHaveTextContent("Link copied");
    expect(node).toHaveAttribute("aria-live", "polite");
  });

  test("renders nothing when closed", () => {
    render(<Toast open={false} message="Hidden" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});
