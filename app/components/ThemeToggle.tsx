"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./Icon";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark(d => !d)}
      aria-label="Toggle theme"
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

const ACCENTS: { value: Accent; swatch: string }[] = [
  { value: "ruby", swatch: "var(--ruby)" },
  { value: "gold", swatch: "var(--gold)" },
  { value: "jade", swatch: "var(--jade)" },
  { value: "indigo", swatch: "#4F5B8B" },
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
