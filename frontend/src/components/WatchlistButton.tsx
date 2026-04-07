"use client";

import { useWatchlist } from "./WatchlistContext";

interface WatchlistButtonProps {
  figureId: number;
  size?: "sm" | "md";
}

export default function WatchlistButton({ figureId, size = "sm" }: WatchlistButtonProps) {
  const { isInWatchlist, addToWatchlist, removeFromWatchlist } = useWatchlist();
  const active = isInWatchlist(figureId);

  const px = size === "sm" ? 28 : 36;
  const iconSize = size === "sm" ? 16 : 22;

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      removeFromWatchlist(figureId);
    } else {
      addToWatchlist(figureId);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={active ? "從收藏移除" : "加入收藏"}
      title={active ? "從收藏移除" : "加入收藏"}
      style={{
        width: px,
        height: px,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: "50%",
        background: active ? "rgba(196,162,101,0.15)" : "rgba(0,0,0,0.5)",
        cursor: "pointer",
        transition: "background 0.15s, transform 0.15s",
        flexShrink: 0,
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.15)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill={active ? "#C4A265" : "none"}
        stroke={active ? "#C4A265" : "#c9d1d9"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
