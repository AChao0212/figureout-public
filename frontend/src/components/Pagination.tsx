"use client";

import Link from "next/link";

interface Props {
  page: number;
  totalPages: number;
  /** URL mode — server-rendered pages that keep state in the query string.
   *  Passed as plain data, not a builder function: a Server Component cannot
   *  hand a function across the client boundary. */
  basePath?: string;
  params?: Record<string, string>;
  /** Callback mode — client pages holding the page in local state. */
  onPage?: (page: number) => void;
}

/**
 * Shared pager. Both /search (URL-driven) and /browse (state-driven) grew
 * their own copy of the same window algorithm; this is that logic once, in
 * the typographic idiom the rest of the site uses — mono, hairline, no boxes.
 */
export default function Pagination({ page, totalPages, basePath, params, onPage }: Props) {
  if (totalPages <= 1) return null;

  const hrefFor = basePath
    ? (p: number) => {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(params ?? {})) if (v) sp.set(k, v);
        sp.set("page", String(p));
        return `${basePath}?${sp.toString()}`;
      }
    : undefined;

  const window: (number | string)[] = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) window.push(i);
  } else {
    window.push(1);
    if (page > 3) window.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      window.push(i);
    }
    if (page < totalPages - 2) window.push("…");
    window.push(totalPages);
  }

  const base =
    "font-mono text-[11px] uppercase tracking-[0.18em] transition-colors";
  const idle = `${base} text-[var(--ink-2)] hover:text-[var(--ink)]`;
  const here = `${base} text-[var(--ink)]`;

  const step = (n: number, label: string, disabled: boolean) => {
    if (disabled) {
      return <span className={`${base} text-[var(--muted)] opacity-40`}>{label}</span>;
    }
    return hrefFor ? (
      <Link href={hrefFor(n)} className={idle}>
        {label}
      </Link>
    ) : (
      <button type="button" onClick={() => onPage?.(n)} className={idle}>
        {label}
      </button>
    );
  };

  return (
    <nav
      className="rule mt-[clamp(26px,4vh,44px)] flex flex-wrap items-center justify-between gap-4 pt-5"
      aria-label="分頁"
    >
      {step(page - 1, "上一頁", page <= 1)}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {window.map((p, i) =>
          typeof p === "string" ? (
            <span key={`gap-${i}`} className={`${base} text-[var(--muted)]`}>
              {p}
            </span>
          ) : p === page ? (
            <span key={p} className={here} aria-current="page">
              {p}
            </span>
          ) : hrefFor ? (
            <Link key={p} href={hrefFor(p)} className={idle}>
              {p}
            </Link>
          ) : (
            <button key={p} type="button" onClick={() => onPage?.(p)} className={idle}>
              {p}
            </button>
          )
        )}
      </div>

      {step(page + 1, "下一頁", page >= totalPages)}
    </nav>
  );
}
