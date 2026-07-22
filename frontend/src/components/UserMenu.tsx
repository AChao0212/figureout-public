"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useColorMode } from "./ColorModeContext";

/**
 * Account control for the top bar.
 *
 * Display currency used to live in here; it moved to the bar itself because
 * it is needed while reading prices, not while managing an account. Everything
 * else the menu carried is unchanged: role, report count, contributor board,
 * admin entry, gain/loss colour convention, sign out.
 */
export default function UserMenu() {
  const { user, token, logout, loading, refreshUser } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Token present but profile never arrived (transient failure) — retry once.
  useEffect(() => {
    if (token && !user && !loading) refreshUser();
  }, [token, user, loading, refreshUser]);

  const barBtn =
    "font-mono text-[11px] tracking-[0.22em] uppercase px-3 py-2 transition-colors";

  if (loading) return null;

  if (!token) {
    return (
      <a href="/login" className={`${barBtn} text-[var(--ink)] hover:opacity-70`}>
        登入
      </a>
    );
  }

  if (!user) {
    return <span className={`${barBtn} text-[var(--muted)]`}>載入中</span>;
  }

  const row =
    "block w-full px-4 py-2.5 text-left text-[13px] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${barBtn} text-[var(--ink-2)] hover:text-[var(--ink)]`}
        aria-expanded={open}
      >
        {user.display_name || user.username}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 w-56 border border-[var(--rule)] bg-[var(--ground)]">
          <div className="border-b border-[var(--rule)] px-4 py-3">
            <p className="text-[13px] text-[var(--ink)]">
              {user.display_name || user.username}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
              {user.role === "admin"
                ? "管理員"
                : user.role === "editor"
                ? "編輯者"
                : "會員"}
              {" · "}
              {user.report_count} 筆回報
            </p>
          </div>

          <a href="/rankings" onClick={() => setOpen(false)} className={row}>
            貢獻排行榜
          </a>
          {(user.role === "editor" || user.role === "admin") && (
            <a href="/admin" onClick={() => setOpen(false)} className={row}>
              管理後台
            </a>
          )}

          <div className="border-t border-[var(--rule)]">
            <button
              type="button"
              onClick={() => {
                toggleColorMode();
                setOpen(false);
              }}
              className={row}
            >
              {colorMode === "default" ? "漲紅跌綠 (台股)" : "漲綠跌紅 (美股)"}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                切換
              </span>
            </button>
          </div>

          <div className="border-t border-[var(--rule)]">
            <button
              type="button"
              onClick={() => {
                logout();
                setOpen(false);
              }}
              className={row}
            >
              登出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
