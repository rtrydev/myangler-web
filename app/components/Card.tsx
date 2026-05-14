import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ className = "", children, ...rest }: CardProps) {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

type NoteProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  children: ReactNode;
};

export function Note({ label = "Note", className = "", children, ...rest }: NoteProps) {
  return (
    <div
      className={`px-3 py-2.5 bg-surface-2 border-l-2 border-gold rounded-r ${className}`.trim()}
      {...rest}
    >
      <div className="ui text-[10px] tracking-[0.14em] uppercase text-gold mb-1">{label}</div>
      <div className="serif text-xs text-ink-2 leading-snug italic">{children}</div>
    </div>
  );
}
