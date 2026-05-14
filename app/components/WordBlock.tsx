import type { HTMLAttributes } from "react";

type WordBlockProps = HTMLAttributes<HTMLDivElement> & {
  mm: string;
  en: string;
  selected?: boolean;
  unknown?: boolean;
};

export function WordBlock({ mm, en, selected, unknown, className = "", ...rest }: WordBlockProps) {
  const mmSize = mm.length > 4 ? 17 : 20;
  const classes = [
    "wblock",
    selected ? "selected" : "",
    unknown ? "unknown" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      <div className="w-mm" style={{ whiteSpace: "nowrap", fontSize: mmSize }}>{mm}</div>
      <div className="w-en">{en}</div>
    </div>
  );
}
