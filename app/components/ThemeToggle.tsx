"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./Icon";

type ThemeToggleProps = {
  /** Controlled mode: parent owns the dark/light state. Without these
   *  props the component falls back to its own internal state, matching
   *  the prototype's drop-in usage. */
  value?: boolean;
  onChange?: (dark: boolean) => void;
};

export function ThemeToggle({ value, onChange }: ThemeToggleProps = {}) {
  const [localDark, setLocalDark] = useState(false);
  const controlled = value !== undefined;
  const dark = controlled ? value : localDark;

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);

  const toggle = () => {
    const next = !dark;
    if (onChange) onChange(next);
    if (!controlled) setLocalDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      aria-pressed={dark}
      className="btn btn-icon"
    >
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}

export type Accent = "ruby" | "gold" | "jade" | "indigo";

type AccentSwitcherProps = {
  value: Accent;
  onChange: (a: Accent) => void;
};

// Swatches sample the frozen `--swatch-*` / `--gold` / `--jade` tokens —
// NOT `--ruby`, which is rewritten by `[data-accent]` rules. If the
// ruby swatch read `var(--ruby)` it would track the selected accent
// instead of representing the ruby option.
const ACCENTS: { value: Accent; swatch: string }[] = [
  { value: "ruby", swatch: "var(--swatch-ruby)" },
  { value: "gold", swatch: "var(--gold)" },
  { value: "jade", swatch: "var(--jade)" },
  { value: "indigo", swatch: "var(--swatch-indigo)" },
];

export function AccentSwitcher({ value, onChange }: AccentSwitcherProps) {
  return (
    <div className="flex gap-2">
      {ACCENTS.map(a => (
        <button
          key={a.value}
          type="button"
          onClick={() => onChange(a.value)}
          aria-label={`Accent ${a.value}`}
          aria-pressed={value === a.value}
          className={`w-7 h-7 rounded-full border-2 transition-transform ${value === a.value ? "scale-110" : "opacity-70 hover:opacity-100"}`}
          style={{
            background: a.swatch,
            borderColor: value === a.value ? "var(--ink)" : "var(--border-2)",
          }}
        />
      ))}
    </div>
  );
}
