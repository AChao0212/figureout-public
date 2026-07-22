"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useColorMode } from "@/components/ColorModeContext";
import { formatCurrency } from "@/lib/currency";

interface TrendingFigure {
  id: number;
  name: string;
  image_url?: string;
  manufacturer?: string;
  scale?: string;
  retail_price?: number;
  current_median_price?: number;
  previous_price?: number;
  change_pct?: number;
  vs_retail_pct?: number;
  character_name?: string;
  franchise_name?: string;
}

/**
 * Headlines are admin-configurable (GET /browse/config/trending-titles), so
 * the rotation stays — it is a real feature and it carries the site's voice.
 * What went is the per-character typewriter and blinking caret: the titles
 * now cross-fade, which reads as considered rather than as a widget.
 */
function RotatingTitle({ texts }: { texts: string[] }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    setI(0);
  }, [texts]);

  useEffect(() => {
    if (texts.length < 2) return;
    const out = setTimeout(() => setShown(false), 4200);
    const swap = setTimeout(() => {
      setI((n) => (n + 1) % texts.length);
      setShown(true);
    }, 4700);
    return () => {
      clearTimeout(out);
      clearTimeout(swap);
    };
  }, [i, texts]);

  return (
    <span
      className="inline-block transition-opacity duration-500 motion-reduce:transition-none"
      style={{ opacity: shown ? 1 : 0 }}
    >
      {texts[i % texts.length]}
    </span>
  );
}

const PERIODS = [
  { key: "3d", label: "3 天" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "365d", label: "一年" },
];

const DEFAULT_BEST_TITLES = ["誰是最強飆股？", "公仔界的台積電！", "買到就是賺到？", "漲到飛天的公仔！"];
const DEFAULT_WORST_TITLES = ["狗莊正在砸盤？", "跳水冠軍出爐！", "韭菜收割現場！", "腰斬的慘烈現場"];

export default function TrendingPage() {
  const [period, setPeriod] = useState("7d");
  const [mode, setMode] = useState<"best" | "worst">("best");
  const [figures, setFigures] = useState<TrendingFigure[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const { upColor, downColor } = useColorMode();

  // Backend converts prices to the requested display currency when given `?currency=`,
  // so the frontend just formats them with the right symbol.
  const fmt = (price: number, currency: string) => formatCurrency(price, currency);

  const [bestTitles, setBestTitles] = useState<string[]>(DEFAULT_BEST_TITLES);
  const [worstTitles, setWorstTitles] = useState<string[]>(DEFAULT_WORST_TITLES);

  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiUrl}/browse/config/trending-titles`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          if (Array.isArray(data.best) && data.best.length > 0) setBestTitles(data.best);
          if (Array.isArray(data.worst) && data.worst.length > 0) setWorstTitles(data.worst);
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  const currency =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("currency") || "TWD"
      : "TWD";

  useEffect(() => {
    setLoading(true);
    fetch(`${apiUrl}/browse/trending?period=${period}&mode=${mode}&limit=20&currency=${encodeURIComponent(currency)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.items) {
          setFigures(data.items);
          setIsFallback(data.fallback || false);
        } else if (Array.isArray(data)) {
          setFigures(data);
          setIsFallback(false);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period, mode, apiUrl, currency]);

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <div className="pb-[clamp(20px,3.5vh,34px)]">
        <span className="lbl">排行榜</span>
        <h1 className="display">
          <RotatingTitle texts={mode === "best" ? bestTitles : worstTitles} />
        </h1>
      </div>

      {/* controls: period on the left, direction on the right */}
      <div className="rule-b flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pb-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className="seg"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-x-6">
          <button
            type="button"
            onClick={() => setMode("best")}
            aria-pressed={mode === "best"}
            className="seg"
          >
            漲幅
          </button>
          <button
            type="button"
            onClick={() => setMode("worst")}
            aria-pressed={mode === "worst"}
            className="seg"
          >
            跌幅
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
          載入中
        </p>
      ) : figures.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-[15px] text-[var(--ink)]">此期間暫無足夠資料</p>
          <p className="mt-2 text-[13px] text-[var(--ink-2)]">需要至少兩個不同日期的價格快照</p>
        </div>
      ) : (
        <>
          {isFallback && (
            <p className="border-b border-[var(--rule-faint)] py-3 text-[13px] text-[var(--ink-2)]">
              此期間無新交易資料，目前顯示所有公仔與定價的比較排行
            </p>
          )}

          <div className="tbl-scroll pt-4">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>公仔</th>
                  <th>現價</th>
                  <th className="hidden sm:table-cell">前價</th>
                  <th>漲跌幅</th>
                  <th className="hidden sm:table-cell">vs 定價</th>
                </tr>
              </thead>
              <tbody>
                {figures.map((fig, i) => {
                  const isPositive = (fig.change_pct ?? 0) >= 0;
                  const color = isPositive ? upColor : downColor;
                  const arrow = isPositive ? "▲" : "▼";
                  return (
                    <tr key={fig.id}>
                      <td>{i + 1}</td>
                      <td className="k" style={{ whiteSpace: "normal", minWidth: 220 }}>
                        <Link href={`/figures/${fig.id}`} className="flex items-center gap-3">
                          {fig.image_url && (
                            <img
                              src={fig.image_url}
                              alt=""
                              className="h-10 w-10 shrink-0 border border-[var(--rule-faint)] object-contain"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-sans text-[13.5px] text-[var(--ink)]">
                              {fig.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                              {fig.manufacturer || "未知"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="k">
                        {fig.current_median_price ? fmt(fig.current_median_price, currency) : "--"}
                      </td>
                      <td className="hidden sm:table-cell">
                        {fig.previous_price ? fmt(fig.previous_price, currency) : "--"}
                      </td>
                      <td style={{ color }}>
                        {arrow} {Math.abs(fig.change_pct ?? 0).toFixed(1)}%
                      </td>
                      <td className="hidden sm:table-cell">
                        {fig.vs_retail_pct != null ? (
                          <span style={{ color: fig.vs_retail_pct >= 0 ? upColor : downColor }}>
                            {fig.vs_retail_pct >= 0 ? "▲" : "▼"} {Math.abs(fig.vs_retail_pct).toFixed(1)}%
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
