"use client";

// Settings panel content. Pure presentation — receives the current
// theme / accent state via props and emits changes to the parent so
// the AppShell can persist them. Designed to live inside a `Sheet`.

import { AccentSwitcher, ThemeToggle, type Accent } from "@/app/components/ThemeToggle";
import { Button } from "@/app/components/Button";
import { CloseIcon } from "@/app/components/Icon";
import { Eyebrow, RuleGold } from "@/app/components/Ornament";

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
          <h2 className="serif text-[28px] leading-tight text-ink tracking-tight -ml-[3px]">
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

        <DataSources />
      </div>
    </div>
  );
}

function DataSources() {
  return (
    <section
      aria-labelledby="settings-data-sources"
      className="flex flex-col gap-2"
    >
      <Eyebrow id="settings-data-sources" gold withRule>
        Data sources
      </Eyebrow>
      <p className="serif text-[13px] text-ink-2 leading-relaxed">
        Dictionary data: <strong className="text-ink">EngMyanDictionary</strong>{" "}
        by Soe Minn Minn, via the{" "}
        <a
          href="https://huggingface.co/datasets/chuuhtetnaing/english-myanmar-dictionary-dataset-EngMyanDictionary"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold underline decoration-gold/50 underline-offset-2 hover:decoration-gold"
        >
          chuuhtetnaing HuggingFace dataset
        </a>
        . Licensed under{" "}
        <a
          href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold underline decoration-gold/50 underline-offset-2 hover:decoration-gold"
        >
          GPL-2.0
        </a>
        .
      </p>
      <p className="serif text-[13px] text-ink-2 leading-relaxed">
        Word segmentation uses n-gram data from{" "}
        <a
          href="https://github.com/ye-kyaw-thu/myWord"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold underline decoration-gold/50 underline-offset-2 hover:decoration-gold"
        >
          myWord
        </a>{" "}
        by Ye Kyaw Thu.
      </p>
    </section>
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
