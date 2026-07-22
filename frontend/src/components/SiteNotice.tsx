"use client";

import { useEffect, useState } from "react";

// Bump this key when the notice text changes so previously-dismissed users see it again.
const DISMISS_KEY = "figureout_notice_dismissed_v1";

/**
 * Dismissible site-wide notice for temporary third-party outages.
 * When hpoi.net's CDN recovers, delete this component (or just early-return null).
 */
export default function SiteNotice() {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid hydration flash

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  return (
    <div className="border-b border-[var(--rule)]">
      <div className="col flex items-start justify-between gap-4 py-2.5">
        <p className="text-[13px] leading-snug text-[var(--ink-2)]">
          部分公仔圖片暫時無法顯示 — 圖片來源站（
          <span className="font-mono">hpoi.net</span>
          ）CDN 異常，非本站故障。價格與交易資料正常。
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {}
            setDismissed(true);
          }}
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          aria-label="關閉通知"
        >
          關閉
        </button>
      </div>
    </div>
  );
}
