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

  test("mousedown anywhere outside the sheet surface fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <div>
        <button type="button" data-testid="outside">outside thing</button>
        <Sheet open={true} onClose={onClose} label="Settings">
          <p>sheet body</p>
        </Sheet>
      </div>,
    );
    // The outside button lives entirely outside the Sheet's positioned
    // parent — the document-level handler is what catches this.
    await user.click(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });

  test("mousedown inside the sheet surface does NOT fire onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open={true} onClose={onClose} label="Settings">
        <p>sheet body</p>
        <button type="button" data-testid="inside">inside thing</button>
      </Sheet>,
    );
    await user.click(screen.getByTestId("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("outside-click handler is unregistered when the sheet closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <div>
        <button type="button" data-testid="outside">outside thing</button>
        <Sheet open={true} onClose={onClose} label="Settings">
          <p>sheet body</p>
        </Sheet>
      </div>,
    );
    rerender(
      <div>
        <button type="button" data-testid="outside">outside thing</button>
        <Sheet open={false} onClose={onClose} label="Settings">
          <p>sheet body</p>
        </Sheet>
      </div>,
    );
    await user.click(screen.getByTestId("outside"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
