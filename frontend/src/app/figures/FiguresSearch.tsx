"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageTracker from "@/components/PageTracker";

interface FigureOut {
  id: number;
  name: string;
  manufacturer?: string;
  scale?: string;
  image_url?: string;
  retail_price?: number;
  franchise_name?: string;
  character_name?: string;
}

export default function FiguresSearch() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const [figures, setFigures] = useState<FigureOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!q) { setLoading(false); return; }
    setLoading(true);
    fetch(`${apiUrl}/figures?q=${encodeURIComponent(q)}&limit=100`)
      .then(r => r.json())
      .then(d => { setFigures(d.figures || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, q]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageTracker page={`/figures?q=${q}`} />
      <h1 className="mb-1 text-xl font-bold text-[#e6edf3]">
        搜尋：{q}
      </h1>
      <p className="mb-6 text-sm text-[#8b949e]">
        {loading ? "搜尋中..." : `共 ${total} 個結果`}
      </p>

      {!loading && figures.length === 0 && (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-12 text-center text-sm text-[#6e7681]">
          找不到相關公仔
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {figures.map((fig) => (
          <Link
            key={fig.id}
            href={`/figures/${fig.id}`}
            className="group overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] transition-shadow hover:border-[#484f58]"
          >
            {fig.image_url ? (
              <div className="aspect-square overflow-hidden bg-[#0d1117]">
                <img
                  src={fig.image_url}
                  alt={fig.name}
                  className="h-full w-full object-contain transition-transform group-hover:scale-105"
                />
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center bg-[#0d1117] text-xs text-[#484f58]">
                No Image
              </div>
            )}
            <div className="p-2">
              <p className="line-clamp-2 text-xs font-medium text-[#c9d1d9]">{fig.name}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {fig.manufacturer && (
                  <span className="text-[10px] text-[#6e7681]">{fig.manufacturer}</span>
                )}
                {fig.scale && (
                  <span className="text-[10px] text-[#6e7681]">{fig.scale}</span>
                )}
              </div>
              {fig.retail_price && (
                <p className="mt-1 text-xs font-semibold text-[#C4A265]">
                  NT${Math.round(fig.retail_price / 149.5 * 32.2).toLocaleString()}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
