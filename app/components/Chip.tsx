import type { HTMLAttributes, ReactNode } from "react";

export type ChipVariant = "default" | "solid" | "exact" | "partial" | "fuzzy";

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: ChipVariant;
  children: ReactNode;
};

const variantClass: Record<ChipVariant, string> = {
  default: "",
  solid: "chip-solid",
  exact: "tag-exact",
  partial: "tag-partial",
  fuzzy: "tag-fuzzy",
};

export function Chip({ variant = "default", className = "", children, ...rest }: ChipProps) {
  return (
    <span className={`chip ${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
