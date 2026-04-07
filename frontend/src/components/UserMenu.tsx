"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useColorMode } from "./ColorModeContext";

const CURRENCIES = [
  { code: "TWD", label: "NT$" },
  { code: "JPY", label: "\u00a5" },
  { code: "USD", label: "$" },
  { code: "CNY", label: "\u00a5" },
];

export default function UserMenu() {
  const { user, logout, loading } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Read current currency from URL or localStorage
  const [currency, setCurrencyState] = useState("TWD");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("figureout_currency");
    const fromUrl = new URLSearchParams(window.location.search).get("currency");
    setCurrencyState(fromUrl || saved || "TWD");
  }, []);

  const setCurrency = (code: string) => {
    localStorage.setItem("figureout_currency", code);
    // Update URL and reload to apply currency change
    const url = new URL(window.location.href);
    url.searchParams.set("currency", code);
    window.location.href = url.toString();
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (loading) return null;

  if (!user) {
    return (
      <a href="/login" className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs font-medium text-[#C4A265] transition-colors hover:border-[#C4A265]/50 hover:bg-[#C4A265]/10">
        登入
      </a>
    );
  }

  // Logged in: user button with dropdown including settings
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-[#30363d] px-3 py-1.5 text-xs font-medium text-[#c9d1d9] transition-colors hover:border-[#C4A265]/50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        {user.display_name || user.username}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-[#30363d] bg-[#161b22] py-1 shadow-xl">
          <div className="border-b border-[#30363d] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-[#c9d1d9]">{user.display_name || user.username}</p>
              {user.role === "admin" && <span className="rounded-full bg-[#C4A265]/20 px-1.5 py-0.5 text-[9px] text-[#C4A265]">管理員</span>}
              {user.role === "editor" && <span className="rounded-full bg-blue-900/30 px-1.5 py-0.5 text-[9px] text-blue-400">編輯者</span>}
            </div>
            <p className="text-[10px] text-[#6e7681]">{user.report_count} 筆回報</p>
          </div>
          <a href="/rankings" onClick={() => setOpen(false)} className="block px-3 py-2 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]">
            貢獻排行榜
          </a>
          {(user.role === "editor" || user.role === "admin") && (
            <a href="/admin" onClick={() => setOpen(false)} className="block px-3 py-2 text-xs text-[#C4A265] hover:bg-[#21262d]">
              管理後台
            </a>
          )}
          <div className="border-t border-[#30363d]">
            <div className="px-3 py-2">
              <p className="mb-1.5 text-[10px] font-medium text-[#6e7681]">顯示幣別</p>
              <div className="flex gap-1">
                {CURRENCIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setCurrency(c.code)}
                    className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                      currency === c.code
                        ? "bg-[#C4A265]/20 text-[#C4A265]"
                        : "text-[#6e7681] hover:text-[#c9d1d9]"
                    }`}
                  >
                    {c.code}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => { toggleColorMode(); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]"
            >
              {colorMode === "default" ? "漲紅跌綠 (台股)" : "漲綠跌紅 (美股)"}
              <span className="ml-auto text-[10px] text-[#484f58]">切換</span>
            </button>
          </div>
          <div className="border-t border-[#30363d]">
            <button onClick={() => { logout(); setOpen(false); }} className="block w-full px-3 py-2 text-left text-xs text-[#f85149] hover:bg-[#21262d]">
              登出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
