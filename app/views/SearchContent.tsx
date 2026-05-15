"use client";

// Search-tab content: switches between the three states based on the
// orchestrator's `SearchResult` discriminator.
//
//   - empty / unrecognized → `IdleView`
//   - too_long             → length-error view
//   - breakdown            → `BreakdownView` (Burmese / mixed)
//   - reverse              → `ResultsView` (Latin → ranked)
//
// Pure presentation: the parent owns `result` and click callbacks.

import type { Entry } from "@/app/lib/lookup";
import type {
  BreakdownToken,
  ResultRow as ResultRowType,
  SearchResult,
} from "@/app/lib/search";
import { Chip } from "@/app/components/Chip";
import { Eyebrow } from "@/app/components/Ornament";
import { Logo } from "@/app/components/Logo";
import { Note } from "@/app/components/Card";
import { OfflineIcon } from "@/app/components/Icon";
import { ResultRow } from "@/app/components/ResultRow";
import { WordBlock } from "@/app/components/WordBlock";

type SearchContentProps = {
  result: SearchResult;
  selectedEntryId?: number | null;
  /** Total entries shipped — drives the "Ready offline · N entries" line. */
  totalEntries?: number | null;
  onSelectToken?: (token: BreakdownToken) => void;
  onSelectRow?: (entry: Entry, row: ResultRowType) => void;
  onChip?: (sample: string) => void;
};

const SAMPLE_CHIPS = [
  "မင်္ဂလာပါ",
  "ကျေးဇူးတင်ပါတယ်",
  "water",
  "ဒီနေ့ ရာသီဥတု အေးတယ်",
  "thank you",
];

export function SearchContent({
  result,
  selectedEntryId = null,
  totalEntries = null,
  onSelectToken,
  onSelectRow,
  onChip,
}: SearchContentProps) {
  if (result.kind === "too_long") {
    return (
      <div
        className="flex-1 paper-tex px-5 py-10 text-center"
        data-testid="too-long-view"
      >
        <Eyebrow>Too long</Eyebrow>
        <p className="serif italic text-ink-2 mt-3">
          {result.length}-character input exceeds the {result.limit}-character
          limit. Trim the query and try again.
        </p>
      </div>
    );
  }
  if (result.kind === "unrecognized" || result.kind === "empty") {
    return (
      <IdleView totalEntries={totalEntries} onChip={onChip} />
    );
  }
  if (result.kind === "breakdown") {
    return (
      <BreakdownView
        tokens={result.tokens}
        selectedEntryId={selectedEntryId}
        onSelectToken={onSelectToken}
      />
    );
  }
  // reverse
  return (
    <ResultsView
      rows={result.rows}
      selectedEntryId={selectedEntryId}
      onSelectRow={onSelectRow}
    />
  );
}

/* ─────────────────────────── Idle ─────────────────────────── */

function IdleView({
  totalEntries,
  onChip,
}: {
  totalEntries: number | null;
  onChip?: (sample: string) => void;
}) {
  return (
    <div
      className="flex-1 px-5 pt-2 pb-5 overflow-y-auto no-scroll paper-tex flex flex-col"
      data-testid="idle-view"
    >
      <div className="flex flex-col items-center pt-6 gap-4">
        <Logo size={68} />
        <div className="serif text-[26px] leading-tight text-center text-ink tracking-[0.005em]">
          A pocket dictionary
          <br />
          <span className="italic text-ink-2">for Burmese &amp; English.</span>
        </div>
        <div className="mm text-lg text-gold mt-0.5">
          မြန်မာ ⟷ အင်္ဂလိပ်
        </div>
      </div>

      <div className="mt-9">
        <Eyebrow withRule>How to use</Eyebrow>
        <ol className="flex flex-col gap-3.5 mt-2.5 list-none p-0 m-0">
          {[
            { num: "၁", en: "Type any word — Burmese or English. We figure out which." },
            { num: "၂", en: "Paste a Burmese sentence. We split it into tappable blocks." },
            { num: "၃", en: "No internet needed once installed to your home screen." },
          ].map(s => (
            <li key={s.num} className="flex gap-3.5 items-baseline">
              <span className="mm text-[22px] text-gold min-w-[22px] text-center">
                {s.num}
              </span>
              <span className="serif text-sm text-ink-2 leading-snug">{s.en}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-8">
        <Eyebrow withRule>Try</Eyebrow>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {SAMPLE_CHIPS.map(sample => (
            <Chip
              key={sample}
              role="button"
              tabIndex={0}
              onClick={() => onChip?.(sample)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChip?.(sample);
                }
              }}
              className={/[A-Za-z]/.test(sample) ? "serif" : "mm"}
              style={{
                textTransform: "none",
                letterSpacing: 0,
                fontSize: 13,
                padding: "6px 12px",
                cursor: onChip ? "pointer" : "default",
              }}
            >
              {sample}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-6 flex items-center gap-2 justify-center text-jade">
        <OfflineIcon size={14} />
        <span className="ui text-[11px] tracking-wide text-jade">
          Ready offline{totalEntries ? ` · ${totalEntries.toLocaleString()} entries` : ""}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────── Breakdown ─────────────────────── */

function BreakdownView({
  tokens,
  selectedEntryId,
  onSelectToken,
}: {
  tokens: readonly BreakdownToken[];
  selectedEntryId: number | null;
  onSelectToken?: (token: BreakdownToken) => void;
}) {
  const knownTokens = tokens.filter(t => t.result !== null);
  const wordCount = knownTokens.length;
  return (
    <div
      className="flex-1 overflow-y-auto no-scroll paper-tex"
      data-testid="breakdown-view"
    >
      <div className="px-4 pt-1 pb-4">
        <div className="mt-2 mb-4">
          <Eyebrow withRule>
            {wordCount === 1 ? "1 word" : `${wordCount} words`}
          </Eyebrow>
        </div>

        <div className="mm text-xl text-ink-2 leading-relaxed pb-3.5 mb-4 border-b border-dashed border-border-2">
          {tokens.map(t => t.token).join("")}
          <div className="serif italic text-[13px] text-ink-3 mt-1.5">
            tap any block for the full entry
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {tokens.map((token, i) => {
            const entry = token.result?.entry;
            const en = entry?.glosses[0] ?? "—";
            const isSelected =
              !!entry && selectedEntryId !== null && entry.entryId === selectedEntryId;
            return (
              <WordBlock
                key={`${token.token}-${i}`}
                mm={token.token}
                en={en}
                selected={isSelected}
                unknown={token.result === null}
                role="button"
                tabIndex={onSelectToken && token.result !== null ? 0 : -1}
                aria-pressed={isSelected}
                aria-disabled={token.result === null || undefined}
                onClick={() => token.result && onSelectToken?.(token)}
                onKeyDown={e => {
                  if (
                    token.result &&
                    onSelectToken &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onSelectToken(token);
                  }
                }}
              />
            );
          })}
        </div>

        <div className="mt-5">
          <Note label="Note">
            We give our best split. If a word looks off, look it up alone in the
            box above.
          </Note>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Results ──────────────────────── */

function ResultsView({
  rows,
  selectedEntryId,
  onSelectRow,
}: {
  rows: readonly ResultRowType[];
  selectedEntryId: number | null;
  onSelectRow?: (entry: Entry, row: ResultRowType) => void;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="flex-1 overflow-y-auto no-scroll paper-tex px-5 py-8 text-center"
        data-testid="results-empty"
      >
        <Eyebrow>No matches</Eyebrow>
        <p className="serif italic text-ink-2 mt-3">
          We couldn&rsquo;t find anything for that. Try a related word, or fewer
          letters.
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex-1 overflow-y-auto no-scroll paper-tex"
      data-testid="results-view"
    >
      <div className="px-4 pt-2 flex justify-between items-center">
        <Eyebrow>
          {rows.length === 1 ? "1 result" : `${rows.length} results`} ·
          English → မြန်မာ
        </Eyebrow>
      </div>
      <div className="mt-3">
        {rows.map(row => {
          const first = row.entries[0];
          if (!first) return null;
          const group = row.entries.map(e => e.headword);
          const en = first.glosses[0] ?? row.key;
          const meaning = first.glosses.slice(1).join("; ") || undefined;
          const tag =
            row.fuzzy
              ? "fuzzy"
              : row.tier === 0
                ? "exact"
                : "partial";
          const isSelected =
            selectedEntryId !== null &&
            row.entries.some(e => e.entryId === selectedEntryId);
          return (
            <ResultRow
              key={`${row.key}-${first.entryId}`}
              group={group.length > 1 ? group : undefined}
              mm={group.length === 1 ? group[0] : undefined}
              en={en}
              meaning={meaning}
              tag={tag}
              note={row.fuzzy ? `near match · distance ${row.distance}` : undefined}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              data-testid={`result-row-${first.entryId}`}
              onClick={() => onSelectRow?.(first, row)}
              onKeyDown={e => {
                if (onSelectRow && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelectRow(first, row);
                }
              }}
            />
          );
        })}
      </div>
      <div className="px-4 pt-4 pb-6 text-center">
        <div className="serif italic text-[12px] text-ink-faint leading-snug">
          Top results only. Narrow your search to find more.
        </div>
      </div>
    </div>
  );
}
