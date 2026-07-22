"use client";

import { useEffect, useState } from "react";
import CountUp from "./CountUp";

interface Stats {
  figures: number;
  figures_with_price: number;
  listings: number;
  views_today: number;
  total_views: number;
}

/**
 * The numbers are the site's credibility, so they are stated plainly and
 * never dressed up: label above, figure below, one hairline row. No claim
 * copy — "38,944 件" argues better than an adjective does.
 */
export default function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiUrl}/browse/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => {});
  }, [apiUrl]);

  if (!stats) return null;

  const items = [
    { label: "公仔總數", value: stats.figures },
    { label: "有價格資料", value: stats.figures_with_price },
    { label: "成交紀錄", value: stats.listings },
    { label: "今日瀏覽", value: stats.views_today },
    { label: "總瀏覽次數", value: stats.total_views },
  ];

  return (
    <div className="rule grid grid-cols-3 gap-x-6 gap-y-6 pt-6 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label}>
          <span className="lbl">{item.label}</span>
          <CountUp
            value={item.value}
            className="num block text-[clamp(17px,2vw,22px)] leading-none tracking-[-0.02em] text-[var(--ink)]"
          />
        </div>
      ))}
    </div>
  );
}
