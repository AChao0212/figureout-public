"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Franchise {
  id: number;
  name: string;
  name_zh?: string;
  category?: string;
}

const PAGE_SIZE = 60;

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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3] sm:text-2xl">瀏覽作品</h1>
          {!loading && <p className="mt-0.5 text-xs text-[#6e7681]">共 {total} 個作品</p>}
        </div>
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋作品名稱..."
            className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-[#c9d1d9] placeholder-gray-400 outline-none focus:border-[#C4A265] focus:ring-1 focus:ring-[#C4A265]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#8b949e]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-[#6e7681]">載入中...</div>
      ) : franchises.length === 0 ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-10 text-center">
          <p className="text-sm text-[#6e7681]">
            {query ? `找不到「${query}」相關作品` : "目前沒有作品資料"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
            {displayed.map((franchise) => (
              <Link
                key={franchise.id}
                href={`/browse/${franchise.id}`}
                className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 transition-all hover:border-[#484f58] sm:p-4"
              >
                <p className="text-sm font-medium text-[#c9d1d9]">
                  {franchise.name}
                </p>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="rounded-md border border-[#30363d] px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-xs text-[#8b949e] transition-colors hover:border-[#484f58] hover:text-[#c9d1d9] disabled:opacity-30"
              >
                上一頁
              </button>
              {(() => {
                const pages: (number | string)[] = [];
                if (totalPages <= 5) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push("...");
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push("...");
                  pages.push(totalPages);
                }
                return pages.map((p, idx) =>
                  typeof p === "string" ? (
                    <span key={`ellipsis-${idx}`} className="px-1 py-1 text-[11px] sm:px-1.5 sm:py-1.5 sm:text-xs text-[#6e7681]">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors sm:px-3 sm:py-1.5 sm:text-xs ${
                        p === page
                          ? "bg-[#C4A265]/20 text-[#C4A265] border border-[#C4A265]/30"
                          : "border border-[#30363d] text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
                      }`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="rounded-md border border-[#30363d] px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-xs text-[#8b949e] transition-colors hover:border-[#484f58] hover:text-[#c9d1d9] disabled:opacity-30"
              >
                下一頁
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
