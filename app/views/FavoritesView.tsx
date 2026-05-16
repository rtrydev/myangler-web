"use client";

// Favorites tab: every entry the user has saved. Clicking an item opens
// it (re-resolves through the engine). Empty state nudges the user to
// save something.

import { useMemo, useState } from "react";
import { Chip } from "@/app/components/Chip";
import { StarFillIcon } from "@/app/components/Icon";
import { Eyebrow, RuleGold } from "@/app/components/Ornament";
import type { FavoriteItem } from "@/app/lib/app/types";

type FavoritesViewProps = {
  items: readonly FavoriteItem[];
  onSelect?: (item: FavoriteItem) => void;
};

export function FavoritesView({ items, onSelect }: FavoritesViewProps) {
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.tag) set.add(i.tag);
    return ["all", ...set];
  }, [items]);

  const [active, setActive] = useState<string>("all");

  const filtered = useMemo(
    () => (active === "all" ? items : items.filter(i => i.tag === active)),
    [items, active],
  );

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden paper-tex"
      data-testid="favorites-view"
    >
      <div className="px-5.5 pt-5 pb-3.5 flex justify-between items-center gap-3 shrink-0">
        <div>
          <div className="eyebrow eyebrow-gold mb-1.5">Library</div>
          <h2 className="serif text-[28px] leading-tight text-ink tracking-tight">
            Saved
          </h2>
          <div className="mm text-sm text-gold mt-1.5 leading-snug">သိမ်းဆည်းထားသော</div>
        </div>
        {/* Matches the History tab's Clear button anchor: `items-center`
            on the row + `p-2 leading-none` here puts the count in the
            same vertical position the Clear button occupies on History. */}
        <span className="ui text-xs text-ink-3 p-2 leading-none">
          {items.length} {items.length === 1 ? "word" : "words"}
        </span>
      </div>

      <div className="px-5.5 shrink-0">
        <RuleGold />
      </div>

      {tags.length > 1 && (
        <div className="px-5 pt-3 pb-3">
          <div className="flex gap-1.5 flex-wrap">
            {tags.map(tag => {
              const isActive = tag === active;
              return (
                <Chip
                  key={tag}
                  role="button"
                  tabIndex={0}
                  variant={isActive ? "solid" : "default"}
                  onClick={() => setActive(tag)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(tag);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {tag}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto no-scroll">
        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center" data-testid="favorites-empty">
            <Eyebrow>{items.length === 0 ? "Nothing saved yet" : "No matches"}</Eyebrow>
            <p className="serif italic text-ink-2 mt-3">
              {items.length === 0
                ? "Open an entry and tap Save to add it to your library."
                : "No saved entries match the selected tag."}
            </p>
          </div>
        ) : (
          <ul className="list-none p-0 m-0">
            {filtered.map((item, i) => (
              <li
                key={item.entryId}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(item)}
                  className="w-full flex justify-between items-start px-5 py-3.5 gap-3 text-left hover:bg-surface cursor-pointer"
                  data-testid={`favorite-item-${i}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="mm text-xl text-ink leading-tight">
                      {item.headword}
                    </div>
                    <div className="serif italic text-[13px] text-ink-3 mt-1">
                      {item.glosses.join("; ")}
                    </div>
                    {item.tag && (
                      <div className="mt-1.5">
                        <Chip
                          style={{
                            fontSize: 9.5,
                            padding: "2px 8px",
                          }}
                        >
                          {item.tag}
                        </Chip>
                      </div>
                    )}
                  </div>
                  <div className="text-gold">
                    <StarFillIcon size={18} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
