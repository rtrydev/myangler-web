// Brief, auto-dismissed confirmation banner. Controlled — the parent
// owns `open` and is responsible for timing it out. Floats above the
// rest of the chrome (including `Sheet`) and is themed via tokens so
// it works across light/dark and every accent.

import type { ReactNode } from "react";

type ToastProps = {
  open: boolean;
  message: ReactNode;
};

export function Toast({ open, message }: ToastProps) {
  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-paper border border-gold rounded-full ui text-[12px] tracking-wide text-ink"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      {message}
    </div>
  );
}
