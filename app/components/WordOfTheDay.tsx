// Featured "word of the day" card for the desktop detail rail's idle
// state — so the rail carries content instead of sitting empty when no
// entry is selected. Deliberately NOT a faux-selection: it has its own
// eyebrow + a single "See full entry" CTA (rather than save/copy/share),
// so it reads as an invitation to explore, and opening it hands off to
// the real selected-entry flow in `AppShell`.
//
// Layout mirrors `EntryDetail` (header · gold rule · scrollable senses ·
// pinned footer) so the rail feels consistent whichever it shows.

import type { Entry } from "@/app/lib/lookup";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { ArrowIcon } from "./Icon";
import { RuleGold } from "./Ornament";

type WordOfTheDayProps = {
  entry: Entry;
  /** Open the full entry (the parent sets the query + selects it). */
  onOpen?: (entry: Entry) => void;
};

// Senses shown in the preview; the rest live behind the CTA.
const GLOSS_CAP = 5;

export function WordOfTheDay({ entry, onOpen }: WordOfTheDayProps) {
  const shown = entry.glosses.slice(0, GLOSS_CAP);
  const extra = entry.glosses.length - shown.length;
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="word-of-the-day">
      <div className="px-5.5 pt-5 pb-3.5 shrink-0">
        <div className="eyebrow eyebrow-gold mb-1.5">Word of the day</div>
        <div className="mm text-sm text-gold-deep leading-snug mb-3">
          ဒီနေ့ စကားလုံး
        </div>
        <div className="mm text-[40px] text-ink" style={{ lineHeight: 1.5 }}>
          {entry.headword}
        </div>
        <div className="flex items-center gap-2.5 mt-2 flex-wrap">
          {entry.ipa && (
            <span className="serif italic text-sm text-ink-3">/{entry.ipa}/</span>
          )}
          {entry.pos && <Chip>{entry.pos}</Chip>}
        </div>
      </div>

      <div className="px-5.5 shrink-0">
        <RuleGold />
      </div>

      <div className="px-5.5 pt-4 overflow-y-auto no-scroll flex-1 min-h-0">
        <div className="eyebrow mb-2.5">Meanings</div>
        <ol
          className="flex flex-col gap-3 list-none p-0 m-0 pl-4"
          style={{
            borderLeft:
              "2px solid color-mix(in oklab, var(--gold) 40%, transparent)",
          }}
          aria-label="Meanings"
        >
          {shown.map((gloss, i) => (
            <li key={i} className="flex gap-3.5 items-baseline">
              <span className="serif text-sm text-gold-deep min-w-3.5">
                {i + 1}.
              </span>
              <span className="serif text-[17px] text-ink">{gloss}</span>
            </li>
          ))}
        </ol>
        {extra > 0 && (
          <div className="serif italic text-[12.5px] text-ink-3 mt-3 pl-4">
            +{extra} more {extra === 1 ? "sense" : "senses"} in the full entry.
          </div>
        )}
      </div>

      <div className="px-5.5 pt-4 pb-5.5 shrink-0 bg-paper border-t border-border">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => onOpen?.(entry)}
          aria-label={`See full entry for ${entry.headword}`}
        >
          See full entry <ArrowIcon size={14} />
        </Button>
      </div>
    </div>
  );
}
