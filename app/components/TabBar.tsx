import type { ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
};

type TabBarProps = {
  items: TabItem[];
  active: string;
  onChange?: (id: string) => void;
};

export function TabBar({ items, active, onChange }: TabBarProps) {
  return (
    <div className="tabbar flex border-t border-border bg-paper">
      {items.map(it => {
        const isActive = it.id === active;
        return (
          <button
            type="button"
            key={it.id}
            onClick={() => onChange?.(it.id)}
            className={`flex-1 pt-2.5 pb-5.5 flex flex-col items-center gap-1 cursor-pointer ui text-[10px] tracking-[0.06em] uppercase ${isActive ? "text-gold" : "text-ink-faint"}`}
          >
            {it.icon({ size: 22 })}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
