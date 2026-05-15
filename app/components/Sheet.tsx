"use client";

// Bottom-sheet modal primitive. Renders a theme-aware dim scrim (via
// `--modal-dim`), a backdrop blur, and a sheet with a soft upward
// shadow + gold hairline highlight along the top edge — matching the
// design system contract from the prototype.
//
// Reused for the entry detail (mobile bottom sheet over the search
// pane) and the settings panel (hamburger-menu overlay). The scrim
// closes the sheet on click; Escape does the same.

import { useEffect, type ReactNode } from "react";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Surfaces via `aria-label`; required
   *  so the dialog announces meaningfully to screen readers. */
  label: string;
  children: ReactNode;
};

export function Sheet({ open, onClose, label, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={`Close ${label.toLowerCase()}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{
          background: "var(--modal-dim)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 bg-paper flex flex-col overflow-hidden"
        style={{
          borderRadius: "22px 22px 0 0",
          boxShadow: "var(--modal-shadow)",
          maxHeight: "92%",
        }}
        data-testid="sheet-surface"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 right-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--gold-soft) 50%, transparent)",
            opacity: 0.35,
          }}
        />
        <div className="flex justify-center pt-2">
          <div
            className="w-9 h-1 rounded-full bg-ink-faint"
            style={{ opacity: 0.4 }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
