"use client";

// Bottom-sheet modal primitive. Renders a sheet with a soft elevation
// shadow + gold hairline highlight along the top edge — matching the
// design system contract from the prototype.
//
// Reused for the entry detail (mobile bottom sheet over the search
// pane) and the settings panel (hamburger-menu overlay).
//
// Dismissal paths:
//   - Escape key
//   - Click / tap anywhere outside the sheet surface — handled by a
//     document-level mousedown listener gated against the surface via a
//     ref. We use document-level (rather than an in-container scrim
//     button) so the dismissal works even for chrome that lives outside
//     the Sheet's positioned parent — the header, search input, etc.
//     The opening gesture's mousedown has already finished dispatching
//     by the time React commits `open=true` and this listener attaches,
//     so a click that opens the sheet can never close it.

import { useEffect, useRef, type ReactNode } from "react";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Surfaces via `aria-label`; required
   *  so the dialog announces meaningfully to screen readers. */
  label: string;
  /** CSS height of the sheet surface (any valid CSS length / %).
   *  Defaults to `92%` of the relatively-positioned container so a thin
   *  strip of the underlying content peeks through at the top. Pass
   *  `"98%"` or `"100%"` for sheets whose content needs more vertical
   *  room (e.g. multi-step walkthroughs). */
  height?: string;
  children: ReactNode;
};

export function Sheet({
  open,
  onClose,
  label,
  height = "92%",
  children,
}: SheetProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use `mousedown` (not `click`) so the dismissal lands on the press
    // — the same gesture that opened the sheet has already finished
    // dispatching by the time React commits `open=true` and this
    // listener attaches, so the opening interaction itself can't trip
    // it. Taps that start inside the sheet are excluded via the ref
    // check; taps that start anywhere else dismiss.
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (surfaceRef.current && surfaceRef.current.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        ref={surfaceRef}
        className="absolute left-0 right-0 bottom-0 bg-paper flex flex-col overflow-hidden pointer-events-auto"
        style={{
          borderRadius: "22px 22px 0 0",
          boxShadow: "var(--modal-shadow)",
          height,
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
        <div className="flex justify-center pt-2 shrink-0">
          <div
            className="w-9 h-1 rounded-full bg-ink-faint"
            style={{ opacity: 0.4 }}
          />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
