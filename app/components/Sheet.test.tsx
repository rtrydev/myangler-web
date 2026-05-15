import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  test("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} label="Test sheet">
        <p>hidden</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
  });

  test("renders a labeled dialog with its children when open", () => {
    render(
      <Sheet open={true} onClose={() => {}} label="Settings">
        <p>sheet body</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText("sheet body")).toBeInTheDocument();
  });

  test("the close-scrim button's aria-label is derived from the dialog label", () => {
    render(
      <Sheet open={true} onClose={() => {}} label="Entry detail">
        <p>x</p>
      </Sheet>,
    );
    expect(
      screen.getByRole("button", { name: /close entry detail/i }),
    ).toBeInTheDocument();
  });

  test("clicking the scrim fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open={true} onClose={onClose} label="Settings">
        <p>sheet body</p>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("Escape key fires onClose when open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open={true} onClose={onClose} label="Settings">
        <p>sheet body</p>
      </Sheet>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("Escape key does nothing when closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open={false} onClose={onClose} label="Settings">
        <p>sheet body</p>
      </Sheet>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
