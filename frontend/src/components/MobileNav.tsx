"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthContext";
import { useColorMode } from "./ColorModeContext";

const CURRENCIES = [
  { code: "TWD", label: "NT$" },
  { code: "JPY", label: "\u00a5" },
  { code: "USD", label: "$" },
  { code: "CNY", label: "\u00a5" },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { user, logout, loading } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();

  const currentCurrency = typeof window !== "undefined"
    ? localStorage.getItem("figureout_currency") || new URLSearchParams(window.location.search).get("currency") || "TWD"
    : "TWD";

  const setCurrency = (code: string) => {
    localStorage.setItem("figureout_currency", code);
    const url = new URL(window.location.href);
    url.searchParams.set("currency", code);
    window.location.href = url.toString();
  };

  const close = () => setOpen(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="p-2.5 text-[#8b949e] hover:text-[#e6edf3]"
        aria-label="Toggle menu"
      >
        {open ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-14 z-50 border-b border-[#30363d] bg-[#161b22] shadow-lg">
          <nav className="flex flex-col px-4 py-3 text-sm">
            <Link href="/" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              首頁
            </Link>
            <Link href="/browse" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              瀏覽
            </Link>
            <Link href="/trending" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              排行榜
            </Link>
            <Link href="/watchlist" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              收藏
            </Link>
            <Link href="/submit" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              提交公仔
            </Link>
            <Link href="/rankings" onClick={close} className="rounded-lg px-3 py-3 text-[#c9d1d9] hover:bg-[#0d1117]">
              貢獻排行榜
            </Link>

            {/* Settings */}
            <div className="mt-2 border-t border-[#30363d] pt-2">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[10px] text-[#6e7681]">幣別</span>
                <div className="flex gap-1">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => setCurrency(c.code)}
                      className={`rounded px-2 py-1 text-[10px] font-medium ${
                        currentCurrency === c.code
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
                onClick={() => { toggleColorMode(); close(); }}
                className="w-full rounded-lg px-3 py-2 text-left text-xs text-[#8b949e] hover:bg-[#0d1117]"
              >
                {colorMode === "default" ? "漲紅跌綠 (台股)" : "漲綠跌紅 (美股)"} — 點擊切換
              </button>
            </div>

            {/* User section */}
            <div className="mt-2 border-t border-[#30363d] pt-2">
              {!loading && !user && (
                <Link href="/login" onClick={close} className="flex items-center justify-center rounded-lg bg-[#C4A265] px-3 py-2.5 text-sm font-medium text-white hover:bg-[#B89255]">
                  登入 / 註冊
                </Link>
              )}
              {user && (
                <>
                  <div className="flex items-center justify-between px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-[#c9d1d9]">{user.display_name || user.username}</p>
                      <p className="text-[10px] text-[#6e7681]">{user.report_count} 筆回報</p>
                    </div>
                    {(user.role === "editor" || user.role === "admin") && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                        user.role === "admin" ? "bg-[#C4A265]/20 text-[#C4A265]" : "bg-blue-900/30 text-blue-400"
                      }`}>
                        {user.role === "admin" ? "管理員" : "編輯者"}
                      </span>
                    )}
                  </div>
                  {(user.role === "editor" || user.role === "admin") && (
                    <Link href="/admin" onClick={close} className="rounded-lg px-3 py-2 text-xs text-[#C4A265] hover:bg-[#0d1117]">
                      管理後台
                    </Link>
                  )}
                  <button
                    onClick={() => { logout(); close(); }}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs text-[#f85149] hover:bg-[#0d1117]"
                  >
                    登出
                  </button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
