"use client";

import { useWatchlist } from "./WatchlistContext";

interface WatchlistButtonProps {
  figureId: number;
  /** Retained for call-site compatibility; the control is now typographic
   *  and sizes itself from the type scale. */
  size?: "sm" | "md";
  /** "overlay" sits on a photograph and needs its own ground behind it;
   *  "inline" belongs in an action row and stands on the page. */
  variant?: "overlay" | "inline";
}

export default function WatchlistButton({
  figureId,
  variant = "overlay",
}: WatchlistButtonProps) {
  const { isInWatchlist, addToWatchlist, removeFromWatchlist } = useWatchlist();
  const active = isInWatchlist(figureId);

  const toggle = (e: React.MouseEvent) => {
    // Tiles wrap this in a <Link>, so the click must not navigate.
    e.preventDefault();
    e.stopPropagation();
    if (active) removeFromWatchlist(figureId);
    else addToWatchlist(figureId);
  };

  const base =
    "font-mono text-[10px] uppercase tracking-[0.2em] transition-colors cursor-pointer";

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        aria-label={active ? "從收藏移除" : "加入收藏"}
        className={`${base} ${
          active
            ? "text-[var(--ink)]"
            : "text-[var(--ink-2)] hover:text-[var(--ink)]"
        }`}
      >
        {active ? "已收藏" : "加入收藏"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? "從收藏移除" : "加入收藏"}
      className={`${base} bg-[rgba(8,8,10,0.72)] px-2.5 py-1.5 text-[var(--ink)] hover:bg-[rgba(8,8,10,0.9)]`}
    >
      {active ? "已收藏" : "收藏"}
    </button>
  );
}
