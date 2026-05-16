"use client";

// History tab: shows the user's persisted search/lookup history.
// Renders an empty state when there's nothing yet. Each item is
// clickable and re-runs the query when activated.

import { Button } from "@/app/components/Button";
import { Chip } from "@/app/components/Chip";
import { TrashIcon } from "@/app/components/Icon";
import { Eyebrow, RuleGold } from "@/app/components/Ornament";
import type { HistoryItem } from "@/app/lib/app/types";

type HistoryViewProps = {
  items: readonly HistoryItem[];
  onSelect?: (item: HistoryItem) => void;
  onClear?: () => void;
};

function relativeTime(at: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - at) / 1000));
  if (diffSec < 60) return "just now";
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days`;
  return new Date(at).toLocaleDateString();
}

function isSentenceQuery(item: HistoryItem): boolean {
  return /\s/.test(item.query.trim());
}

export function HistoryView({ items, onSelect, onClear }: HistoryViewProps) {
  return (
    <div
      className="flex-1 flex flex-col overflow-hidden paper-tex"
      data-testid="history-view"
    >
      <div className="px-5.5 pt-5 pb-3.5 flex justify-between items-center gap-3 shrink-0">
        <div>
          <div className="eyebrow eyebrow-gold mb-1.5">Recent</div>
          <h2 className="serif text-[28px] leading-tight text-ink tracking-tight -ml-[3px]">
            History
          </h2>
          <div className="mm text-sm text-gold mt-1.5 leading-snug">သမိုင်း</div>
        </div>
        {items.length > 0 && onClear && (
          <Button
            variant="ghost"
            onClick={onClear}
            // `leading-none` collapses the inherited 1.5 line-height that
            // would otherwise leave "Clear" floating below the icon's
            // optical center inside the flex row.
            className="p-2! text-xs! leading-none"
            aria-label="Clear history"
          >
            <TrashIcon size={14} /> Clear
          </Button>
        )}
      </div>

      <div className="px-5.5 shrink-0">
        <RuleGold />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-scroll pt-2">
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center" data-testid="history-empty">
            <Eyebrow>No history yet</Eyebrow>
            <p className="serif italic text-ink-2 mt-3">
              Words and sentences you look up will appear here.
            </p>
          </div>
        ) : (
          <ul className="list-none p-0 m-0">
            {items.map((item, i) => {
              const isSent = isSentenceQuery(item);
              const isLatin = item.kind === "latin";
              return (
                <li
                  key={`${item.query}-${item.at}`}
                  className="border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onSelect?.(item)}
                    className="w-full flex justify-between items-start px-5.5 py-3 gap-3 text-left hover:bg-surface cursor-pointer"
                    data-testid={`history-item-${i}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className={`${isLatin ? "serif" : "mm"} text-base text-ink ${
                          isSent
                            ? "leading-snug"
                            : isLatin
                              ? "truncate"
                              : "truncate leading-[2.5]"
                        }`}
                      >
                        {item.query}
                      </div>
                      <div className="serif italic text-[12.5px] text-ink-3 mt-1">
                        {isLatin ? "English search" : isSent ? "sentence" : "word"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="ui text-[10.5px] text-ink-faint">
                        {relativeTime(item.at)}
                      </span>
                      {isSent && (
                        <Chip
                          style={{ fontSize: 9, padding: "2px 7px" }}
                        >
                          sentence
                        </Chip>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export { relativeTime };
