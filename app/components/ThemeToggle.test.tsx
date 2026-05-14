import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle, AccentSwitcher, type Accent } from "./ThemeToggle";
import { useState } from "react";

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle", () => {
  test("renders as a labelled button", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });

  test("clicking adds the dark class to <html>; clicking again removes it", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /toggle theme/i });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("is reachable by keyboard and toggles on Enter", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.tab();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

function ControlledAccent({ initial = "ruby" as Accent, onChange = vi.fn() }) {
  const [v, setV] = useState<Accent>(initial);
  return (
    <AccentSwitcher
      value={v}
      onChange={a => {
        setV(a);
        onChange(a);
      }}
    />
  );
}

describe("AccentSwitcher", () => {
  test("renders one button per accent with a descriptive accessible name", () => {
    render(<AccentSwitcher value="ruby" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /accent ruby/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accent gold/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accent jade/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accent indigo/i })).toBeInTheDocument();
  });

  test("clicking an accent calls onChange with the chosen value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AccentSwitcher value="ruby" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /accent gold/i }));
    expect(onChange).toHaveBeenCalledWith("gold");

    await user.click(screen.getByRole("button", { name: /accent jade/i }));
    expect(onChange).toHaveBeenCalledWith("jade");
  });

  test("the selected accent is the only one rendered without the unselected opacity class", () => {
    render(<ControlledAccent initial="gold" />);
    const gold = screen.getByRole("button", { name: /accent gold/i });
    const ruby = screen.getByRole("button", { name: /accent ruby/i });
    expect(gold).not.toHaveClass("opacity-70");
    expect(ruby).toHaveClass("opacity-70");
  });

  test("changing the selection updates which button is marked selected", async () => {
    const user = userEvent.setup();
    render(<ControlledAccent initial="ruby" />);

    expect(screen.getByRole("button", { name: /accent ruby/i })).not.toHaveClass("opacity-70");

    await user.click(screen.getByRole("button", { name: /accent jade/i }));

    expect(screen.getByRole("button", { name: /accent jade/i })).not.toHaveClass("opacity-70");
    expect(screen.getByRole("button", { name: /accent ruby/i })).toHaveClass("opacity-70");
  });
});
