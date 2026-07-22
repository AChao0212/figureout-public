"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "./AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Unread indicator for the top bar. Typographic rather than iconographic to
 * match the rest of the chrome: the word carries the label, and unread state
 * is carried by a dot — never by recolouring the word, so the bar keeps one
 * text colour per line.
 */
export default function NotificationBell() {
  const { user, token } = useAuth();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCount(typeof data === "number" ? data : data.count ?? 0);
      }
    } catch {
      /* silently ignore */
    }
  }, [token]);

  useEffect(() => {
    if (!user) return;
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => clearInterval(id);
  }, [user, fetchCount]);

  if (!user) return null;

  return (
    <Link
      href="/watchlist"
      className="relative px-3 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
      aria-label={count > 0 ? `通知，${count} 則未讀` : "通知"}
    >
      通知
      {count > 0 && (
        <span
          className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-[var(--ink)]"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
