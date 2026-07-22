"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Pagination from "@/components/Pagination";

interface Franchise {
  id: number;
  name: string;
  name_zh?: string;
  category?: string;
}

const PAGE_SIZE = 60;

/**
 * Franchise index. A franchise is a name and nothing else, so it is set as a
 * plain list on hairlines rather than a grid of boxes — the old tiles were
 * mostly border and padding around one short string.
 */
export default function BrowsePage() {
  const [query, setQuery] = useState("");
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "600" });
      if (query) params.set("q", query);
      fetch(`${apiUrl}/browse/franchises?${params}`)
        .then((r) => r.json())
        .then((data) => {
          setTotal(data.length);
          setFranchises(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, apiUrl]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const displayed = franchises.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <div className="flex flex-col gap-5 pb-[clamp(18px,3vh,28px)] sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display">瀏覽作品</h1>
          {!loading && (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
              共 {total.toLocaleString("en-US")} 個作品
            </p>
          )}
        </div>

        <div className="field w-full sm:w-72">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋作品名稱"
            aria-label="搜尋作品名稱"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="rule py-10 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
          載入中
        </p>
      ) : franchises.length === 0 ? (
        <p className="rule py-10 text-center text-[14px] text-[var(--ink-2)]">
          {query ? `找不到「${query}」相關作品` : "目前沒有作品資料"}
        </p>
      ) : (
        <>
          <div className="rule grid grid-cols-2 gap-x-8 sm:grid-cols-3 lg:grid-cols-4">
            {displayed.map((franchise) => (
              <Link
                key={franchise.id}
                href={`/browse/${franchise.id}`}
                className="border-b border-[var(--rule-faint)] py-3.5 text-[14px] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              >
                {franchise.name}
              </Link>
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
