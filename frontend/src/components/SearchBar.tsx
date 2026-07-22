"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SearchBarProps {
  defaultValue?: string;
  large?: boolean;
}

/**
 * A ruled line, not a boxed input. The glyph marks it as search without a
 * label, and Enter submits — so there is no button competing with the field.
 */
export default function SearchBar({ defaultValue = "", large = false }: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="field gap-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`shrink-0 fill-none stroke-[var(--muted)] ${large ? "h-[18px] w-[18px]" : "h-4 w-4"}`}
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋公仔、角色、系列或製造商"
          aria-label="搜尋公仔、角色、系列或製造商"
          className={large ? "!text-[16px]" : "!text-[14px]"}
        />
        <button
          type="submit"
          className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
        >
          Enter
        </button>
      </div>
    </form>
  );
}
