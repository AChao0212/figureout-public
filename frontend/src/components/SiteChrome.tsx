"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import UserMenu from "./UserMenu";

/**
 * The whole global shell: a fixed bar carrying only the four controls that
 * must always be reachable (currency, notifications, account, menu), plus a
 * full-screen curtain menu holding every destination.
 *
 * Everything else that used to sit in the header now lives in the menu, which
 * is what keeps the bar quiet no matter how many routes the site grows.
 */

const DESTINATIONS: { href: string; en: string; zh: string }[] = [
  { href: "/browse", en: "Browse", zh: "瀏覽" },
  { href: "/trending", en: "Trending", zh: "排行榜" },
  { href: "/watchlist", en: "Watchlist", zh: "收藏" },
  { href: "/submit", en: "Submit", zh: "提交公仔" },
  { href: "/rankings", en: "Contributors", zh: "貢獻排行榜" },
];

const CURRENCIES = ["TWD", "JPY", "USD", "CNY"];
const CHROME_EXT =
  "https://chromewebstore.google.com/detail/figureout-price-reporter/bbeeniochakeccockgedlbgehmhhoknb";
const GITHUB = "https://github.com/AChao0212/figureout-public";

export default function SiteChrome() {
  const router = useRouter();
  const pathname = usePathname();

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [curOpen, setCurOpen] = useState(false);
  const [currency, setCurrency] = useState("TWD");
  const curRef = useRef<HTMLDivElement>(null);

  /* bar goes frosted only once the page has moved */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* currency: URL wins, then the remembered choice */
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("currency");
    const saved = localStorage.getItem("figureout_currency");
    setCurrency(fromUrl || saved || "TWD");
  }, [pathname]);

  const pickCurrency = useCallback(
    (code: string) => {
      localStorage.setItem("figureout_currency", code);
      setCurrency(code);
      setCurOpen(false);
      const params = new URLSearchParams(window.location.search);
      params.set("currency", code);
      // Soft navigation so in-progress form state survives the switch.
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname]
  );

  useEffect(() => {
    if (!curOpen) return;
    const away = (e: MouseEvent) => {
      if (curRef.current && !curRef.current.contains(e.target as Node)) setCurOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [curOpen]);

  /* Lock scrolling while the curtain is open by swallowing the events rather
   * than toggling overflow — overflow:hidden shifts layout on macOS. */
  useEffect(() => {
    if (!menuOpen) return;
    const stop = (e: Event) => e.preventDefault();
    const keys = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) {
        e.preventDefault();
      }
    };
    document.addEventListener("wheel", stop, { passive: false });
    document.addEventListener("touchmove", stop, { passive: false });
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("wheel", stop);
      document.removeEventListener("touchmove", stop);
      document.removeEventListener("keydown", keys);
    };
  }, [menuOpen]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  /* close the curtain on route change */
  useEffect(() => setMenuOpen(false), [pathname]);

  const barBtn =
    "font-mono text-[11px] tracking-[0.22em] uppercase px-3 py-2 text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors";

  return (
    <>
      <div
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter] duration-200 ${
          scrolled ? "bg-[rgba(8,8,10,0.78)] backdrop-blur-xl" : "bg-transparent"
        }`}
      >
        <div className="col flex h-[var(--bar)] items-center justify-between">
          <Link
            href="/"
            className="font-mono text-[14px] uppercase tracking-[0.26em] text-[var(--ink)] transition-opacity hover:opacity-70"
          >
            FigureOut
          </Link>

          <div className="flex items-center">
            {/* currency — moved out of the account menu so it is reachable
                while browsing prices, which is when it is actually needed */}
            <div className="relative" ref={curRef}>
              <button
                type="button"
                onClick={() => setCurOpen((o) => !o)}
                className={barBtn}
                aria-expanded={curOpen}
                aria-label="切換顯示幣別"
              >
                {currency}
              </button>
              {curOpen && (
                <div className="absolute right-0 top-full z-50 border border-[var(--rule)] bg-[var(--ground)]">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickCurrency(c)}
                      className={`block w-full px-4 py-2 text-left font-mono text-[11px] uppercase tracking-[0.22em] transition-colors hover:text-[var(--ink)] ${
                        c === currency ? "text-[var(--ink)]" : "text-[var(--ink-2)]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* No notification bell: routers/notifications.py and the
                transactions.py code that would create the rows are both
                unregistered in main.py, so the endpoint 404s and the count is
                always zero. Mount <NotificationBell /> here once that chain is
                actually wired up. */}
            <UserMenu />

            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={barBtn}
              aria-expanded={menuOpen}
            >
              Menu
            </button>
          </div>
        </div>
      </div>

      <div className={`menu ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <div className="col flex h-full flex-col justify-center">
          <ul className="list-none p-0">
            {DESTINATIONS.map((d, i) => (
              <li
                key={d.href}
                className="menu-item"
                style={{ ["--i" as string]: String(i) }}
              >
                <Link href={d.href} className="menu-link" onClick={() => setMenuOpen(false)}>
                  <span className="rowline">
                    <span className="en">{d.en}</span>
                    <span>{d.zh}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-[clamp(30px,5vh,56px)] flex flex-wrap gap-x-[34px] gap-y-[14px]">
            <a
              className="menu-item font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              style={{ ["--i" as string]: String(DESTINATIONS.length) }}
              href={CHROME_EXT}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              Chrome 擴充功能 ↗
            </a>
            <a
              className="menu-item font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              style={{ ["--i" as string]: String(DESTINATIONS.length + 1) }}
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              GitHub ↗
            </a>
            <Link
              className="menu-item font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              style={{ ["--i" as string]: String(DESTINATIONS.length + 2) }}
              href="/privacy"
              onClick={() => setMenuOpen(false)}
            >
              隱私權政策 ↗
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
