"use client";

import { useEffect, useState } from "react";

interface Stats {
  figures: number;
  figures_with_price: number;
  listings: number;
  views_today: number;
  total_views: number;
}

export default function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiUrl}/browse/stats`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setStats(d))
      .catch(() => {});
  }, [apiUrl]);

  if (!stats) return null;

  const items = [
    { label: "公仔總數", value: stats.figures.toLocaleString() },
    { label: "有價格資料", value: stats.figures_with_price.toLocaleString() },
    { label: "成交紀錄", value: stats.listings.toLocaleString() },
    { label: "今日瀏覽", value: stats.views_today.toLocaleString() },
    { label: "總瀏覽次數", value: stats.total_views.toLocaleString() },
  ];

  return (
    <div className="mx-auto mt-10 w-full max-w-4xl">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col items-center rounded-lg border border-[#30363d] bg-[#0d1117]/80 px-2 py-3 text-center sm:px-3 sm:py-4"
          >
            <span className="text-base font-bold text-[#C4A265] sm:text-xl">{item.value}</span>
            <span className="mt-1 text-[10px] text-[#6e7681]">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-[10px] text-[#484f58]">
      </p>
    </div>
  );
}
