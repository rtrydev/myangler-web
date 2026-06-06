import type { HTMLAttributes } from "react";
import type { PosCategory } from "@/app/lib/app/pos";

type WordBlockProps = HTMLAttributes<HTMLDivElement> & {
  mm: string;
  en: string;
  selected?: boolean;
  unknown?: boolean;
  /** Which language sits on top of the tile. Defaults to `"mm"` (the
   *  Burmese-breakdown layout: Burmese headword large on top, English
   *  gloss italic below). Pass `"en"` for English-breakdown tiles
   *  (English source large on top, Burmese translation below). */
  primary?: "mm" | "en";
  /** Part-of-speech category — keys the tile's bottom-border hue. Omit
   *  (or pass with `unknown`) to use the default gold border. */
  category?: PosCategory;
};

export function WordBlock({
  mm,
  en,
  selected,
  unknown,
  primary = "mm",
  category,
  className = "",
  ...rest
}: WordBlockProps) {
  const mmSize = mm.length > 4 ? 17 : 20;
  const classes = [
    "wblock",
    primary === "en" ? "en-primary" : "",
    selected ? "selected" : "",
    unknown ? "unknown" : "",
    // Color coding only applies to known tiles; unknown tiles keep their
    // dashed faint border as the "no match" signal.
    !unknown && category ? `pos-${category}` : "",
    className,
  ].filter(Boolean).join(" ");
  if (primary === "en") {
    return (
      <div className={classes} {...rest}>
        <div className="w-en-top">{en}</div>
        <div className="w-mm-sub">{mm}</div>
      </div>
    );
  }
  return (
    <div className={classes} {...rest}>
      <div className="w-mm" style={{ whiteSpace: "nowrap", fontSize: mmSize }}>{mm}</div>
      <div className="w-en">{en}</div>
    </div>
  );
}
