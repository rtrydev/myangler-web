"use client";

import type { InputHTMLAttributes } from "react";
import { SearchIcon, CloseIcon } from "./Icon";

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  onClear?: () => void;
};

export function SearchInput({ value, onClear, className = "", ...rest }: SearchInputProps) {
  const showClear = !!(typeof value === "string" && value.length > 0 && onClear);
  return (
    <div className={`relative ${className}`.trim()}>
      <div className="absolute left-4.5 top-1/2 -translate-y-1/2 text-ink-3">
        <SearchIcon size={20} />
      </div>
      <input className="search-input" value={value} {...rest} />
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-3 w-6 h-6 rounded-full bg-surface-2 flex items-center justify-center cursor-pointer hover:text-ink"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}
