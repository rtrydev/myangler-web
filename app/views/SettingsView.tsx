"use client";

// Settings panel content. Pure presentation — receives the current
// theme / accent state via props and emits changes to the parent so
// the AppShell can persist them. Designed to live inside a `Sheet`.

import { AccentSwitcher, ThemeToggle, type Accent } from "@/app/components/ThemeToggle";
import { Button } from "@/app/components/Button";
import { CloseIcon } from "@/app/components/Icon";
import { RuleGold } from "@/app/components/Ornament";

type SettingsViewProps = {
  accent: Accent;
  onAccentChange: (a: Accent) => void;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  onClose?: () => void;
};

export function SettingsView({
  accent,
  onAccentChange,
  dark,
  onDarkChange,
  onClose,
}: SettingsViewProps) {
  return (
    <div
      className="flex flex-col h-full min-h-0"
      data-testid="settings-view"
    >
      <div className="px-5.5 pt-5 pb-3.5 flex justify-between items-start gap-3 shrink-0">
        <div>
          <div className="eyebrow eyebrow-gold mb-1.5">Settings</div>
          <h2 className="serif text-[28px] leading-tight text-ink tracking-tight">
            Preferences
          </h2>
          <div className="mm text-sm text-gold mt-1.5 leading-snug">ဆက်တင်</div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5!"
          >
            <CloseIcon size={20} />
          </Button>
        )}
      </div>

      <div className="px-5.5 shrink-0">
        <RuleGold />
      </div>

      <div className="px-5.5 pt-4 pb-6 overflow-y-auto no-scroll flex-1 min-h-0 flex flex-col gap-5">
        <SettingsRow
          label="Theme"
          mm="အရောင်အသွေး"
          description={dark ? "Lacquer black for night reading." : "Parchment ivory for daylight."}
        >
          <ThemeToggle value={dark} onChange={onDarkChange} />
        </SettingsRow>

        <SettingsRow
          label="Accent"
          mm="အသားပေးအရောင်"
          description="Primary actions, focus rings, selected states."
        >
          <AccentSwitcher value={accent} onChange={onAccentChange} />
        </SettingsRow>
      </div>
    </div>
  );
}

function SettingsRow({
  label,
  mm,
  description,
  children,
}: {
  label: string;
  mm: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="serif text-[17px] text-ink leading-snug">{label}</div>
        <div className="mm text-[12px] text-gold mt-0.5 leading-snug">{mm}</div>
        <div className="serif italic text-[12.5px] text-ink-3 mt-1 leading-snug">
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
