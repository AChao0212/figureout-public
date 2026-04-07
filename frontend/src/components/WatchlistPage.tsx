"use client";

import { useEffect, useState } from "react";
import { useWatchlist, type WatchlistType } from "./WatchlistContext";
import FigureCard from "./FigureCard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FigureData {
  id: number;
  name: string;
  image_url?: string;
  manufacturer?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
}

function TypeToggle({ figureId }: { figureId: number }) {
  const { getWatchlistType, setWatchlistType } = useWatchlist();
  const wType = getWatchlistType(figureId);

  return (
    <div className="flex rounded-md border border-[#30363d] bg-[#0d1117] text-[10px] overflow-hidden">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWatchlistType(figureId, "interested"); }}
        className={`px-2 py-1 transition-colors ${
          wType === "interested"
            ? "bg-[#C4A265]/20 text-[#C4A265]"
            : "text-[#6e7681] hover:text-[#c9d1d9]"
        }`}
      >
        有興趣
      </button>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWatchlistType(figureId, "owned"); }}
        className={`px-2 py-1 transition-colors border-l border-[#30363d] ${
          wType === "owned"
            ? "bg-[#3fb950]/15 text-[#3fb950]"
            : "text-[#6e7681] hover:text-[#c9d1d9]"
        }`}
      >
        已購入
      </button>
    </div>
  );
}

export default function WatchlistPage() {
  const { watchlist, clearWatchlist } = useWatchlist();
  const [figures, setFigures] = useState<FigureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | WatchlistType>("all");

  const currency = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("currency") || "TWD"
    : "TWD";

  useEffect(() => {
    if (watchlist.length === 0) {
      setFigures([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.allSettled(
      watchlist.map((item) =>
        fetch(`${API_BASE}/figures/${item.id}`).then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json() as Promise<FigureData>;
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const resolved: FigureData[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") resolved.push(r.value);
      }
      setFigures(resolved);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [watchlist]);

  const ownedIds = new Set(watchlist.filter((i) => i.type === "owned").map((i) => i.id));
  const interestedIds = new Set(watchlist.filter((i) => i.type === "interested").map((i) => i.id));

  const filteredFigures = tab === "all"
    ? figures
    : tab === "owned"
      ? figures.filter((f) => ownedIds.has(f.id))
      : figures.filter((f) => interestedIds.has(f.id));

  const ownedCount = ownedIds.size;
  const interestedCount = interestedIds.size;

  if (!loading && watchlist.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <h2 className="text-xl font-semibold text-[#e6edf3]">你的收藏清單是空的</h2>
        <p className="mt-2 text-sm text-[#8b949e]">瀏覽公仔並按下愛心即可加入收藏</p>
        <a href="/" className="mt-6 inline-block rounded-lg bg-[#C4A265] px-6 py-2.5 text-sm font-semibold text-[#0d1117] transition-colors hover:bg-[#B89255]">
          回到首頁
        </a>
      </div>
    );
  }

  const tabs: { key: "all" | WatchlistType; label: string; count: number }[] = [
    { key: "all", label: "全部", count: watchlist.length },
    { key: "interested", label: "有興趣", count: interestedCount },
    { key: "owned", label: "已購入", count: ownedCount },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-[#e6edf3] sm:text-2xl">收藏清單</h1>
        <button type="button" onClick={clearWatchlist} className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#f85149] transition-colors hover:border-[#f85149]/50">
          清空收藏
        </button>
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-[#161b22] text-[#C4A265]" : "text-[#8b949e] hover:text-[#c9d1d9]"}`}>
            {t.label}
            <span className="ml-1.5 text-xs text-[#6e7681]">{t.count}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-[#8b949e]">載入中...</div>
      )}

      {!loading && filteredFigures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filteredFigures.map((fig) => (
            <div key={fig.id} className="flex flex-col">
              <FigureCard
                id={fig.id}
                name={fig.name}
                manufacturer={fig.manufacturer}
                image_url={fig.image_url}
                retail_price={fig.retail_price}
                retail_currency={fig.retail_currency}
                current_median_price={fig.current_median_price}
                price_change_pct={fig.price_change_pct}
                currency={currency}
              />
              <div className="mt-1.5 flex justify-center">
                <TypeToggle figureId={fig.id} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredFigures.length === 0 && watchlist.length > 0 && (
        <div className="py-12 text-center text-sm text-[#6e7681]">
          {tab === "owned" ? "還沒有已購入的公仔" : tab === "interested" ? "還沒有感興趣的公仔" : "清單是空的"}
        </div>
      )}
    </div>
  );
}
