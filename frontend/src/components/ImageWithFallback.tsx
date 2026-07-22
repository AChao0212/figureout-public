"use client";

import { useState } from "react";

interface Props {
  src?: string | null;
  alt?: string;
  className?: string;
  // Compact fallback = just an icon. Full fallback = icon + tiny explanation.
  compact?: boolean;
}

/**
 * <img> that shows a friendly placeholder when the source fails to load.
 * We use this because 99% of figure images are hosted on hpoi.net's CDN,
 * which occasionally has TLS / availability issues. Rather than the browser's
 * default broken-image icon (?), we render a styled placeholder matching the
 * rest of the UI.
 */
export default function ImageWithFallback({ src, alt = "", className = "", compact = false }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-[var(--ground-lift)] text-[var(--muted)] ${className}`}
        role="img"
        aria-label={alt || "無法載入圖片"}
        title="圖片來源 (hpoi.net) 暫時無法載入"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="1" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M21 17l-5-5-8 8" />
        </svg>
        {!compact && (
          <span className="font-mono text-[9px] uppercase tracking-[0.18em]">圖片暫時無法載入</span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
