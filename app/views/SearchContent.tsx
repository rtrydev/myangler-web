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
import { Eyebrow, Flourish } from "@/app/components/Ornament";
import { Logo } from "@/app/components/Logo";
import { Note } from "@/app/components/Card";
import { ResultRow } from "@/app/components/ResultRow";
import { WordBlock } from "@/app/components/WordBlock";
import {
  posCategory,
  POS_CATEGORY_COLOR,
  POS_CATEGORY_LABEL,
  POS_CATEGORY_ORDER,
} from "@/app/lib/app/pos";

type SearchContentProps = {
  result: SearchResult;
  selectedEntryId?: number | null;
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
    return <IdleView onChip={onChip} />;
  }
  if (result.kind === "breakdown") {
    return (
      <BreakdownView
        script={result.script}
        tokens={result.tokens}
        selectedEntryId={selectedEntryId}
        onSelectToken={onSelectToken}
      />
    );
  }
  // reverse
  return (
    <ResultsView
      script={result.script}
      rows={result.rows}
      selectedEntryId={selectedEntryId}
      onSelectRow={onSelectRow}
    />
  );
}

/* ─────────────────────────── Idle ─────────────────────────── */

function IdleView({ onChip }: { onChip?: (sample: string) => void }) {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto no-scroll paper-tex"
      data-testid="idle-view"
    >
      {/* `min-h-full` lets the column center its hero in tall viewports
          while still growing (and scrolling) when content overflows a
          short one. */}
      <div className="min-h-full flex flex-col justify-center">
        <div className="flex flex-col items-center w-full max-w-lg mx-auto px-6 py-10">
          <Logo size={72} />
          <div className="serif text-[27px] leading-tight text-center text-ink tracking-[0.005em] mt-4">
            A pocket dictionary
            <br />
            <span className="italic text-ink-2">for Burmese &amp; English.</span>
          </div>
          <div className="mm text-lg text-gold-deep mt-1.5">
            မြန်မာ ⟷ အင်္ဂလိပ်
          </div>
          <Flourish width={108} className="mt-4 opacity-70" />

          <div className="mt-10 w-full">
            <Eyebrow withRule>How to use</Eyebrow>
            <ol className="flex flex-col gap-3 mt-3.5 list-none p-0 m-0">
              {[
                { num: "၁", en: "Type any word — Burmese or English. We figure out which." },
                { num: "၂", en: "Paste a Burmese sentence. We split it into tappable blocks." },
                { num: "၃", en: "No internet needed once installed to your home screen." },
              ].map(s => (
                <li key={s.num} className="flex gap-3.5 items-center">
                  <span
                    className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full mm text-[15px] text-gold-deep leading-none"
                    style={{
                      border:
                        "1px solid color-mix(in oklab, var(--gold) 45%, transparent)",
                      background:
                        "color-mix(in oklab, var(--gold) 9%, transparent)",
                    }}
                    aria-hidden="true"
                  >
                    {s.num}
                  </span>
                  <span className="serif text-sm text-ink-2 leading-snug">
                    {s.en}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-8 w-full">
            <Eyebrow withRule>Try</Eyebrow>
            <div className="flex flex-wrap gap-2 mt-3.5">
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
        </div>
      </div>
    </div>
  );
}

/* ────────────────────── Breakdown ─────────────────────── */

function BreakdownView({
  script,
  tokens,
  selectedEntryId,
  onSelectToken,
}: {
  script: "burmese" | "english";
  tokens: readonly BreakdownToken[];
  selectedEntryId: number | null;
  onSelectToken?: (token: BreakdownToken) => void;
}) {
  const knownTokens = tokens.filter(t => t.result !== null);
  const wordCount = knownTokens.length;
  const isEnglish = script === "english";
  // Categories actually present among matched tokens, in legend order —
  // so the legend only advertises colors the user can see on screen.
  const presentCategories = POS_CATEGORY_ORDER.filter(cat =>
    knownTokens.some(t => posCategory(t.result!.entry.pos) === cat),
  );
  // For Burmese the sentence preview reads naturally with no spaces
  // (the segmenter removed them at preprocess time). For English we
  // re-introduce a single space between display tokens so the user can
  // recognize the sentence they typed alongside the grouped phrases.
  const sentencePreview = tokens.map(t => t.token).join(isEnglish ? " " : "");
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto no-scroll paper-tex"
      data-testid="breakdown-view"
      data-script={script}
    >
      <div className="px-4 pt-1 pb-4">
        <div className="mt-2 mb-4">
          <Eyebrow withRule>
            {wordCount === 1 ? "1 word" : `${wordCount} words`}
            {isEnglish ? " · English → မြန်မာ" : ""}
          </Eyebrow>
        </div>

        <div
          className={`${
            isEnglish ? "serif" : "mm"
          } text-xl text-ink-2 leading-relaxed pb-3.5 mb-4 border-b border-dashed border-border-2`}
        >
          {sentencePreview}
          <div className="serif italic text-[13px] text-ink-3 mt-1.5">
            tap any block for the full entry
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {tokens.map((token, i) => {
            const entry = token.result?.entry;
            // In Burmese mode the tile's secondary label is the first
            // English gloss of the matched entry; in English mode it
            // is the matched Burmese headword (the translation). The
            // tile's `primary` prop flips the typography so the source
            // token always reads as the larger, primary line.
            const secondary = isEnglish
              ? entry?.headword ?? "—"
              : entry?.glosses[0] ?? "—";
            const category = entry ? posCategory(entry.pos) : undefined;
            const isSelected =
              !!entry && selectedEntryId !== null && entry.entryId === selectedEntryId;
            return (
              <WordBlock
                key={`${token.token}-${i}`}
                mm={isEnglish ? secondary : token.token}
                en={isEnglish ? token.token : secondary}
                primary={isEnglish ? "en" : "mm"}
                category={category}
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

        {presentCategories.length > 1 && (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3.5"
            data-testid="pos-legend"
            aria-label="Part-of-speech legend"
          >
            {presentCategories.map(cat => (
              <span key={cat} className="inline-flex items-center gap-1.5">
                <span
                  className="w-3 h-[2px] rounded-full"
                  style={{ background: POS_CATEGORY_COLOR[cat] }}
                  aria-hidden="true"
                />
                <span className="ui text-[10px] tracking-[0.12em] uppercase text-ink-3">
                  {POS_CATEGORY_LABEL[cat]}
                </span>
              </span>
            ))}
          </div>
        )}

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
  script,
  rows,
  selectedEntryId,
  onSelectRow,
}: {
  script: "burmese" | "latin";
  rows: readonly ResultRowType[];
  selectedEntryId: number | null;
  onSelectRow?: (entry: Entry, row: ResultRowType) => void;
}) {
  const directionLabel =
    script === "latin" ? "English → မြန်မာ" : "မြန်မာ → English";
  if (rows.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-y-auto no-scroll paper-tex px-5 py-8 text-center"
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
      className="flex-1 min-h-0 overflow-y-auto no-scroll paper-tex"
      data-testid="results-view"
    >
      <div className="px-4 pt-2 flex justify-between items-center">
        <Eyebrow>
          {rows.length === 1 ? "1 result" : `${rows.length} results`} ·{" "}
          {directionLabel}
        </Eyebrow>
      </div>
      <div className="mt-3">
        {rows.map(row => {
          const first = row.entries[0];
          if (!first) return null;
          // Keep the visible Burmese group and gloss preview short. The
          // lookup engine's `maxGlossPosition` gate already tightens the
          // result set semantically; these caps are a final layout
          // safety net so a row never wraps to many lines. The full
          // entry is available on tap.
          const allHeadwords = row.entries.map(e => e.headword);
          const groupCap = 8;
          const group = allHeadwords.slice(0, groupCap);
          const extraGroup = allHeadwords.length - group.length;
          const en = first.glosses[0] ?? row.key;
          const meaningCap = 6;
          const meanings = first.glosses.slice(1, 1 + meaningCap);
          const extraMeanings = first.glosses.length - 1 - meanings.length;
          const meaning =
            meanings.length === 0
              ? undefined
              : extraMeanings > 0
                ? `${meanings.join("; ")}; +${extraMeanings} more`
                : meanings.join("; ");
          const noteParts: string[] = [];
          if (extraGroup > 0) noteParts.push(`+${extraGroup} more entries`);
          if (row.fuzzy) noteParts.push(`near match · distance ${row.distance}`);
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
              note={noteParts.length > 0 ? noteParts.join(" · ") : undefined}
              selected={isSelected}
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
        <div className="serif italic text-[12px] text-ink-3 leading-snug">
          Top results only. Narrow your search to find more.
        </div>
      </div>
    </div>
  );
}
