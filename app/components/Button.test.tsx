import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  test("renders its children as the accessible name", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  test("fires onClick when activated by mouse", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  test("fires onClick when activated by keyboard (Enter and Space)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("disabled button is marked disabled and does not fire onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>
    );

    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeDisabled();
    await user.click(btn);

    expect(onClick).not.toHaveBeenCalled();
  });

  test("variant changes the visible styling without breaking the accessible name", () => {
    const { rerender } = render(<Button variant="primary">Action</Button>);
    const before = screen.getByRole("button", { name: "Action" });
    expect(before).toHaveClass("btn-primary");

    rerender(<Button variant="secondary">Action</Button>);
    const after = screen.getByRole("button", { name: "Action" });
    expect(after).toHaveClass("btn-secondary");
    expect(after).not.toHaveClass("btn-primary");
  });

  test("spreads through extra props (type, aria-label, data-*)", () => {
    render(
      <Button type="submit" aria-label="Save changes" data-testid="save-btn">
        <span aria-hidden>icon</span>
      </Button>
    );

    const btn = screen.getByRole("button", { name: "Save changes" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toHaveAttribute("data-testid", "save-btn");
  });
});
