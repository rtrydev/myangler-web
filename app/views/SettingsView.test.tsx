import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Accent } from "@/app/components/ThemeToggle";
import { SettingsView } from "./SettingsView";

const baseProps = {
  accent: "ruby" as Accent,
  onAccentChange: vi.fn(),
  dark: false,
  onDarkChange: vi.fn(),
};

describe("SettingsView", () => {
  test("renders a Theme row and an Accent row", () => {
    render(<SettingsView {...baseProps} />);
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Accent")).toBeInTheDocument();
  });

  test("clicking the theme toggle fires onDarkChange with the next value", async () => {
    const user = userEvent.setup();
    const onDarkChange = vi.fn();
    render(<SettingsView {...baseProps} dark={false} onDarkChange={onDarkChange} />);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(onDarkChange).toHaveBeenCalledWith(true);
  });

  test("toggling from dark calls onDarkChange with false", async () => {
    const user = userEvent.setup();
    const onDarkChange = vi.fn();
    render(<SettingsView {...baseProps} dark={true} onDarkChange={onDarkChange} />);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(onDarkChange).toHaveBeenCalledWith(false);
  });

  test("clicking an accent fires onAccentChange with the chosen accent", async () => {
    const user = userEvent.setup();
    const onAccentChange = vi.fn();
    render(<SettingsView {...baseProps} onAccentChange={onAccentChange} />);
    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    expect(onAccentChange).toHaveBeenCalledWith("jade");
  });

  test("close button is shown only when onClose is supplied; clicking fires it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<SettingsView {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /^close$/i }),
    ).not.toBeInTheDocument();

    rerender(<SettingsView {...baseProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("description text reflects the current theme state", () => {
    const { rerender } = render(<SettingsView {...baseProps} dark={false} />);
    expect(screen.getByText(/parchment ivory/i)).toBeInTheDocument();
    rerender(<SettingsView {...baseProps} dark={true} />);
    expect(screen.getByText(/lacquer black/i)).toBeInTheDocument();
  });
});
