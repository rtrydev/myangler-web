import { Fragment, type HTMLAttributes } from "react";
import { Chip } from "./Chip";

type Tag = "exact" | "partial" | "fuzzy";

type ResultRowProps = HTMLAttributes<HTMLDivElement> & {
  mm?: string;
  group?: string[];
  en: string;
  meaning?: string;
  note?: string;
  tag: Tag;
};

const tagLabel: Record<Tag, string> = {
  exact: "exact",
  partial: "partial",
  fuzzy: "close",
};

export function ResultRow({ mm, group, en, meaning, note, tag, className = "", ...rest }: ResultRowProps) {
  return (
    <div className={`result-row ${className}`.trim()} {...rest}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {group ? group.map((g, i) => (
            <Fragment key={i}>
              <span className="mm text-[20px] text-ink">{g}</span>
              {i < group.length - 1 && <span className="serif text-sm text-ink-faint">·</span>}
            </Fragment>
          )) : (
            <span className="mm text-[20px] text-ink">{mm}</span>
          )}
          <span className="serif italic text-sm text-gold">{en}</span>
        </div>
        {meaning && (
          <div className="serif text-[12.5px] text-ink-3 mt-1 leading-snug">{meaning}</div>
        )}
        {note && (
          <div className="serif text-[11px] text-ink-faint mt-1 italic">{note}</div>
        )}
      </div>
      <Chip variant={tag}>{tagLabel[tag]}</Chip>
    </div>
  );
}
