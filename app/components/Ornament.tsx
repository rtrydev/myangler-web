import type { HTMLAttributes, SVGAttributes } from "react";

export function Ornament({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ornament ${className}`.trim()} {...rest} />;
}

type FlourishProps = SVGAttributes<SVGSVGElement> & {
  /** Pixel width of the rendered mark (height scales proportionally). */
  width?: number;
};

/**
 * Horizontal manuscript flourish: twin curling tendrils flanking a
 * four-pointed bloom, drawn in gold filigree. The composition echoes
 * Burmese illuminated-manuscript scrollwork and the European typographic
 * fleuron — the kind of mark a 19th-century printer would set between
 * chapters. Color comes from `currentColor` so it inherits any
 * `text-*` Tailwind class on the wrapping element.
 */
export function Flourish({
  width = 72,
  className = "",
  ...rest
}: FlourishProps) {
  const height = Math.round((width * 18) / 72);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 72 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`text-gold opacity-70 ${className}`.trim()}
      {...rest}
    >
      {/* Left tendril — gentle S-curve from outer bud toward bloom */}
      <path d="M4 9 C 8 9 10 5 14 6 C 19 7 21 12 26 9" />
      <circle cx="4" cy="9" r="1.1" fill="currentColor" stroke="none" />

      {/* Central four-pointed bloom — pinched-petal compass rosette */}
      <path
        d="M36 2 L 37.5 7.5 L 43 9 L 37.5 10.5 L 36 16 L 34.5 10.5 L 29 9 L 34.5 7.5 Z"
        fill="currentColor"
        fillOpacity={0.18}
      />
      <circle cx="36" cy="9" r="0.9" fill="currentColor" stroke="none" />

      {/* Right tendril — mirror of the left */}
      <path d="M46 9 C 51 12 53 7 58 6 C 62 5 64 9 68 9" />
      <circle cx="68" cy="9" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RuleGold({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rule-gold ${className}`.trim()} {...rest} />;
}

type EyebrowProps = HTMLAttributes<HTMLSpanElement> & {
  gold?: boolean;
  withRule?: boolean;
};

export function Eyebrow({ gold, withRule, className = "", children, ...rest }: EyebrowProps) {
  const label = (
    <span className={`eyebrow ${gold ? "eyebrow-gold" : ""} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
  if (!withRule) return label;
  return (
    <div className="flex items-center gap-2.5">
      {label}
      <RuleGold className="flex-1" />
    </div>
  );
}
