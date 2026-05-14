import type { HTMLAttributes } from "react";

export function Ornament({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ornament ${className}`.trim()} {...rest} />;
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
