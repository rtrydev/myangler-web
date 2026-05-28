"use client";

// "Add to Home Screen" walkthrough. Wraps a `Sheet` and renders a
// numbered list of platform-accurate steps for installing the PWA on
// iOS (Safari) or Android (Chrome / Edge / Samsung Internet).
//
// Presentational only: the parent owns `open`, the detected `platform`
// (so the right tab is selected up front), and the dismiss callback.
// Default platform tab follows the detection; the user can still flip
// the toggle to see the other set of steps without remounting.

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Note } from "./Card";
import { CloseIcon, MenuIcon, ShareIcon } from "./Icon";
import { RuleGold } from "./Ornament";
import { Sheet } from "./Sheet";
import type { InstallPlatform } from "@/app/lib/app/install-prompt";

type InstallGuideProps = {
  open: boolean;
  onClose: () => void;
  /** Detected platform — used to pick which tab is highlighted on open.
   *  `"other"` defaults to the iOS steps so the guide still shows
   *  something useful when the detection is uncertain. */
  platform: InstallPlatform;
};

type Step = {
  num: string;
  body: ReactNode;
};

export function InstallGuide({ open, onClose, platform }: InstallGuideProps) {
  // Derived selection: the auto-detected `platform` picks the default
  // tab, and an explicit user click overrides it via `override`. Storing
  // only the override (rather than mirroring the prop into state with a
  // `useEffect`) means a fresh `platform` from the parent immediately
  // takes effect on the next render and we avoid the React anti-pattern
  // of setState-in-effect for derived state.
  const [override, setOverride] = useState<Visible | null>(null);
  const defaultTab: Visible = platform === "android" ? "android" : "ios";
  const visible: Visible = override ?? defaultTab;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Install Myangler"
      // Walkthrough has a header, platform switcher, four numbered
      // steps, a note, and a footer button — needs the room. Sheet's
      // outside-click dismissal is now a document-level handler scoped
      // to the sheet surface, so taking the full overlay no longer
      // blocks tap-outside.
      height="100%"
    >
      <div
        className="flex flex-col h-full min-h-0"
        data-testid="install-guide"
      >
        <Header onClose={onClose} />

        <div className="px-5.5 shrink-0">
          <RuleGold />
        </div>

        <div className="px-5.5 pt-4 pb-6 overflow-y-auto no-scroll flex-1 min-h-0 flex flex-col gap-5">
          <PlatformSwitcher value={visible} onChange={setOverride} />

          {visible === "ios" ? <IosSteps /> : <AndroidSteps />}

          <Note label="Why install">
            Adds Myangler to your home screen as a standalone app — opens
            full-screen, works offline, and skips the browser chrome.
          </Note>
        </div>

        <div className="px-5.5 pb-6 pt-2 shrink-0">
          <Button
            variant="primary"
            onClick={onClose}
            className="w-full"
            data-testid="install-guide-done"
          >
            Got it
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

type Visible = "ios" | "android";

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-5.5 pt-5 pb-3.5 flex justify-between items-start gap-3 shrink-0">
      <div>
        <div className="eyebrow eyebrow-gold mb-1.5">Install</div>
        <h2 className="serif text-[28px] leading-tight text-ink tracking-tight -ml-[3px]">
          Add to Home Screen
        </h2>
        <div className="mm text-sm text-gold mt-1.5 leading-snug">
          ပင်မမျက်နှာပြင်သို့ ထည့်ပါ
        </div>
      </div>
      <Button
        variant="ghost"
        onClick={onClose}
        aria-label="Close"
        className="p-1.5!"
      >
        <CloseIcon size={20} />
      </Button>
    </div>
  );
}

function PlatformSwitcher({
  value,
  onChange,
}: {
  value: Visible;
  onChange: (v: Visible) => void;
}) {
  // Two-button toggle. Implemented as `Button` instances so the visuals
  // come from the design system — `primary` for the active tab,
  // `secondary` for the inactive one.
  return (
    <div
      role="tablist"
      aria-label="Choose your device"
      className="flex gap-2"
    >
      <Button
        role="tab"
        aria-selected={value === "ios"}
        variant={value === "ios" ? "primary" : "secondary"}
        onClick={() => onChange("ios")}
        className="flex-1"
        data-testid="install-tab-ios"
      >
        iPhone · iPad
      </Button>
      <Button
        role="tab"
        aria-selected={value === "android"}
        variant={value === "android" ? "primary" : "secondary"}
        onClick={() => onChange("android")}
        className="flex-1"
        data-testid="install-tab-android"
      >
        Android
      </Button>
    </div>
  );
}

function IosSteps() {
  const steps: Step[] = [
    {
      num: "၁",
      body: (
        <>
          Open this page in <strong className="text-ink">Safari</strong>. Other
          browsers on iPhone can&rsquo;t add to the Home Screen.
        </>
      ),
    },
    {
      num: "၂",
      body: (
        <>
          Tap the <InlineIcon label="Share" icon={<ShareIcon size={14} />} />{" "}
          <strong className="text-ink">Share</strong> button in the bottom
          toolbar (or top-right on iPad).
        </>
      ),
    },
    {
      num: "၃",
      body: (
        <>
          Scroll down and tap{" "}
          <strong className="text-ink">Add to Home Screen</strong>.
        </>
      ),
    },
    {
      num: "၄",
      body: (
        <>
          Confirm with <strong className="text-ink">Add</strong> in the
          top-right corner. The Myangler icon now lives on your Home Screen.
        </>
      ),
    },
  ];
  return <StepsList ariaLabel="Install on iPhone or iPad" steps={steps} />;
}

function AndroidSteps() {
  const steps: Step[] = [
    {
      num: "၁",
      body: (
        <>
          Open this page in{" "}
          <strong className="text-ink">Chrome</strong>, Edge, or Samsung
          Internet.
        </>
      ),
    },
    {
      num: "၂",
      body: (
        <>
          Tap the <InlineIcon label="Menu" icon={<MenuIcon size={14} />} />{" "}
          <strong className="text-ink">menu</strong> in the top-right corner
          of the browser.
        </>
      ),
    },
    {
      num: "၃",
      body: (
        <>
          Choose <strong className="text-ink">Install app</strong> — or{" "}
          <strong className="text-ink">Add to Home screen</strong> if Install
          isn&rsquo;t listed.
        </>
      ),
    },
    {
      num: "၄",
      body: (
        <>
          Confirm <strong className="text-ink">Install</strong> (or{" "}
          <strong className="text-ink">Add</strong>). Myangler will appear in
          your app drawer and on your home screen.
        </>
      ),
    },
  ];
  return <StepsList ariaLabel="Install on Android" steps={steps} />;
}

function StepsList({
  ariaLabel,
  steps,
}: {
  ariaLabel: string;
  steps: readonly Step[];
}) {
  return (
    <ol
      aria-label={ariaLabel}
      className="flex flex-col gap-3.5 list-none p-0 m-0"
    >
      {steps.map(s => (
        <li key={s.num} className="flex gap-3.5 items-baseline">
          <span className="mm text-[22px] text-gold min-w-[22px] text-center">
            {s.num}
          </span>
          <span className="serif text-sm text-ink-2 leading-snug">
            {s.body}
          </span>
        </li>
      ))}
    </ol>
  );
}

function InlineIcon({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  // Small inline glyph next to a step's button name, drawn at the same
  // baseline as the surrounding serif body text. Wrapped so the icon
  // sits in a parchment-tinted chip that hints at its tappable nature.
  return (
    <span
      aria-label={label}
      role="img"
      className="inline-flex items-center justify-center align-[-3px] w-5 h-5 rounded-sm border border-border bg-surface text-ink-2"
    >
      {icon}
    </span>
  );
}
