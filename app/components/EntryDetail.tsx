// Detail view for a single dictionary entry. Used in two surfaces:
//
//   - Mobile: wrapped in `EntryModal` as a bottom sheet overlay.
//   - Desktop: embedded in the right-hand detail rail.
//
// Pure presentation — receives an `Entry` (and optional related forms)
// and renders the design system's entry layout. Save / copy / share
// callbacks are passed in by the parent.

import { Fragment } from "react";
import type { Entry } from "@/app/lib/lookup";
import { Button } from "./Button";
import {
  CloseIcon,
  CopyIcon,
  ShareIcon,
  StarFillIcon,
  StarIcon,
} from "./Icon";
import { RuleGold } from "./Ornament";

type EntryDetailProps = {
  entry: Entry;
  /** Related entries to show in the "Forms" section (e.g. peers from a
   *  forward lookup's `mergedPeers`, or compounds the caller has
   *  pre-resolved). Empty list collapses the section. */
  related?: readonly Entry[];
  saved?: boolean;
  onSave?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  /** When provided, render a close button in the header. Mobile modal
   *  wires this; desktop rail leaves it undefined. */
  onClose?: () => void;
  onSelectRelated?: (entry: Entry) => void;
};

export function EntryDetail({
  entry,
  related = [],
  saved = false,
  onSave,
  onCopy,
  onShare,
  onClose,
  onSelectRelated,
}: EntryDetailProps) {
  return (
    <div
      className="entry-detail flex flex-col h-full min-h-0"
      data-testid="entry-detail"
    >
      <div className="px-5.5 pt-5 pb-3.5 flex justify-between items-start gap-3 shrink-0">
        <div className="min-w-0">
          <div className="eyebrow eyebrow-gold mb-3.5">Entry</div>
          <div
            className="mm text-[44px] text-ink"
            style={{ lineHeight: 1.5 }}
            data-testid="entry-headword"
          >
            {entry.headword}
          </div>
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            {entry.ipa && (
              <>
                <span className="serif italic text-sm text-ink-3">
                  /{entry.ipa}/
                </span>
                <span className="w-0.75 h-0.75 bg-ink-faint rounded-full" />
              </>
            )}
            <span className="ui text-[11px] text-ink-3 tracking-wide">
              {entry.pos}
            </span>
          </div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close entry"
            className="p-1.5!"
          >
            <CloseIcon size={20} />
          </Button>
        )}
      </div>

      <div className="px-5.5 shrink-0">
        <RuleGold />
      </div>

      <div className="px-5.5 pt-4 overflow-y-auto no-scroll flex-1 min-h-0">
        <div className="eyebrow mb-2.5">Meanings</div>
        <ol className="flex flex-col gap-3 list-none p-0 m-0" aria-label="Meanings">
          {entry.glosses.map((gloss, i) => (
            <li key={i} className="flex gap-3.5 items-baseline">
              <span className="serif text-sm text-gold min-w-3.5">{i + 1}.</span>
              <span className="serif text-[17px] text-ink">{gloss}</span>
            </li>
          ))}
        </ol>

        {related.length > 0 && (
          <div className="mt-5">
            <div className="eyebrow mb-2.5">Forms</div>
            <ul className="flex flex-col list-none p-0 m-0">
              {related.map((r, i) => (
                <Fragment key={r.entryId}>
                  <li>
                    <button
                      type="button"
                      onClick={() => onSelectRelated?.(r)}
                      disabled={!onSelectRelated}
                      className={`w-full flex justify-between items-baseline px-2.5 py-2 gap-3 ${i === 0 ? "" : "border-t border-border"} ${onSelectRelated ? "cursor-pointer hover:bg-surface" : "cursor-default"}`}
                    >
                      <span className="mm text-base text-ink">{r.headword}</span>
                      <span className="serif italic text-[13px] text-ink-3">
                        {r.glosses[0] ?? ""}
                      </span>
                    </button>
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-5.5 pt-4 pb-5.5 flex gap-2.5 shrink-0 bg-paper border-t border-border">
        <Button
          variant="primary"
          className="flex-1"
          onClick={onSave}
          aria-label={saved ? "Remove from saved" : "Save"}
          aria-pressed={saved}
        >
          {saved ? <StarFillIcon size={14} /> : <StarIcon size={14} />}{" "}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button
          variant="icon"
          className="h-auto! w-12!"
          onClick={onCopy}
          aria-label="Copy"
          disabled={!onCopy}
        >
          <CopyIcon size={16} />
        </Button>
        <Button
          variant="icon"
          className="h-auto! w-12!"
          onClick={onShare}
          aria-label="Share"
          disabled={!onShare}
        >
          <ShareIcon size={16} />
        </Button>
      </div>
    </div>
  );
}
