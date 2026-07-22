"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
 const { user, token, logout, loading } = useAuth();
 const { colorMode, toggleColorMode } = useColorMode();

 const router = useRouter();
 const pathname = usePathname();
 const [currentCurrency, setCurrentCurrency] = useState("TWD");
 useEffect(() => {
 if (typeof window === "undefined") return;
 const saved = localStorage.getItem("figureout_currency");
 const fromUrl = new URLSearchParams(window.location.search).get("currency");
 setCurrentCurrency(fromUrl || saved || "TWD");
  }, []);

 const setCurrency = (code: string) => {
 if (typeof window === "undefined") return;
 localStorage.setItem("figureout_currency", code);
 setCurrentCurrency(code);
    // Soft navigation: preserve unsaved form state instead of full reload.
 const params = new URLSearchParams(window.location.search);
 params.set("currency", code);
 router.replace(`${pathname}?${params.toString()}`);
  };

 const close = () => setOpen(false);

 return (
    <>
      <button
 onClick={() => setOpen(!open)}
 className="p-2.5 text-[var(--ink-2)] hover:text-[var(--ink)]"
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
        <div className="absolute left-0 right-0 top-14 z-50 border-b border-[var(--rule)] bg-[var(--ground-lift)] ">
          <nav className="flex flex-col px-4 py-3 text-sm">
            <Link href="/" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              首頁
            </Link>
            <Link href="/browse" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              瀏覽
            </Link>
            <Link href="/trending" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              排行榜
            </Link>
            <Link href="/watchlist" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              收藏
            </Link>
            <Link href="/submit" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              提交公仔
            </Link>
            <Link href="/rankings" onClick={close} className="px-3 py-3 text-[var(--ink)] hover:bg-[var(--ground)]">
              貢獻排行榜
            </Link>

            {/* Settings */}
            <div className="mt-2 border-t border-[var(--rule)] pt-2">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[10px] text-[var(--muted)]">幣別</span>
                <div className="flex gap-1">
                  {CURRENCIES.map((c) => (
                    <button
 key={c.code}
 onClick={() => setCurrency(c.code)}
 className={` px-2 py-1 text-[10px] font-medium ${
 currentCurrency === c.code
                          ? "bg-[var(--ink)]/20 text-[var(--ink)]"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {c.code}
                    </button>
                  ))}
                </div>
              </div>
              <button
 onClick={() => { toggleColorMode(); close(); }}
 className="w-full px-3 py-2 text-left text-xs text-[var(--ink-2)] hover:bg-[var(--ground)]"
              >
                {colorMode === "default" ? "漲紅跌綠 (台股)" : "漲綠跌紅 (美股)"} — 點擊切換
              </button>
            </div>

            {/* User section */}
            <div className="mt-2 border-t border-[var(--rule)] pt-2">
              {!loading && !token && (
                <Link href="/login" onClick={close} className="flex items-center justify-center bg-[var(--ink)] px-3 py-2.5 text-sm font-medium text-[var(--ground)] hover:bg-[var(--ink-2)]">
                  登入 / 註冊
                </Link>
              )}
              {token && !user && (
                <div className="px-3 py-2 text-center text-xs text-[var(--muted)]">載入中...</div>
              )}
              {user && (
                <>
                  <div className="flex items-center justify-between px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-[var(--ink)]">{user.display_name || user.username}</p>
                      <p className="text-[10px] text-[var(--muted)]">{user.report_count} 筆回報</p>
                    </div>
                    {(user.role === "editor" || user.role === "admin") && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
 user.role === "admin" ? "bg-[var(--ink)]/20 text-[var(--ink)]" : "bg-blue-900/30 text-blue-400"
                      }`}>
                        {user.role === "admin" ? "管理員" : "編輯者"}
                      </span>
                    )}
                  </div>
                  {(user.role === "editor" || user.role === "admin") && (
                    <Link href="/admin" onClick={close} className="px-3 py-2 text-xs text-[var(--ink)] hover:bg-[var(--ground)]">
                      管理後台
                    </Link>
                  )}
                  <button
 onClick={() => { logout(); close(); }}
 className="w-full px-3 py-2 text-left text-xs text-[var(--hue-red)] hover:bg-[var(--ground)]"
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
