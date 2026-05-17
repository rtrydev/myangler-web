// Brief, auto-dismissed confirmation banner. Controlled — the parent
// owns `open` and is responsible for timing it out. Floats in the
// top-right corner above the rest of the chrome (including `Sheet`)
// and is themed via tokens so it works across light/dark and every
// accent. Animates in from the right and fades/slides back out before
// unmounting.

import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "./Icon";

type ToastProps = {
  open: boolean;
  message: ReactNode;
};

const EXIT_MS = 220;

export function Toast({ open, message }: ToastProps) {
  // Two-stage state machine so the exit transition plays before
  // unmount. `mounted` controls DOM presence; `shown` toggles the
  // transform/opacity classes that drive the animation. Initialized
  // from `open` so a Toast mounted-already-open renders visibly
  // (the synchronous tests rely on this).
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two RAFs so the browser commits the "hidden" classes before
      // we transition to "shown" — a single frame is sometimes
      // collapsed and the transition is skipped.
      let raf2: number | undefined;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2 !== undefined) cancelAnimationFrame(raf2);
      };
    }
    setShown(false);
    const id = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className={`fixed top-6 right-6 z-50 min-w-[260px] max-w-sm flex items-center gap-3 pl-3.5 pr-4 py-3 bg-paper border border-border border-l-2 border-l-gold rounded-lg transition-all duration-200 ${
        shown
          ? "opacity-100 translate-x-0 ease-out"
          : "opacity-0 translate-x-3 ease-in pointer-events-none"
      }`}
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      <span className="text-gold shrink-0" aria-hidden="true">
        <CheckIcon size={18} />
      </span>
      <span className="serif text-[15px] text-ink leading-snug">{message}</span>
    </div>
  );
}
