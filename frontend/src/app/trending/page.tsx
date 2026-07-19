"use client";

import { useState, useEffect, useRef } from "react";
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



function TypingTitle({ texts, className }: { texts: string[]; className?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const textsRef = useRef(texts);

  // When texts change (mode switch), start deleting current text then switch
  useEffect(() => {
    if (textsRef.current !== texts) {
      textsRef.current = texts;
      setIsDeleting(true);
    }
  }, [texts]);

  useEffect(() => {
    const currentTexts = textsRef.current;
    const safeIndex = currentIndex % currentTexts.length;
    const current = currentTexts[safeIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting && displayed.length < current.length) {
      timeout = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 80);
    } else if (!isDeleting && displayed.length === current.length) {
      timeout = setTimeout(() => setIsDeleting(true), 2000);
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => setDisplayed(current.slice(0, displayed.length - 1)), 40);
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false);
      setCurrentIndex((i) => (i + 1) % currentTexts.length);
    }

    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, currentIndex]);

  return (
    <span className={className}>
      {displayed}
      <span className="animate-pulse">|</span>
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

  // Fetch custom titles from API
  useEffect(() => {
    fetch(`${apiUrl}/browse/config/trending-titles`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          if (Array.isArray(data.best) && data.best.length > 0) setBestTitles(data.best);
          if (Array.isArray(data.worst) && data.worst.length > 0) setWorstTitles(data.worst);
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  const currency = typeof window !== "undefined"
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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Typing animated title */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-[#e6edf3] sm:text-3xl">
          <TypingTitle
            texts={mode === "best" ? bestTitles : worstTitles}
            className="text-[#C4A265]"
          />
        </h1>
        <p className="mt-2 text-sm text-[#8b949e]">
          {mode === "best" ? "近期漲幅最大的公仔排行" : "近期跌幅最大的公仔排行"}
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
        {/* Period selector */}
        <div className="flex gap-1 rounded-lg border border-[#30363d] bg-[#0d1117] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p.key
                  ? "bg-[#C4A265]/20 text-[#C4A265]"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <button
          onClick={() => setMode(mode === "best" ? "worst" : "best")}
          className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-1.5 text-xs font-medium text-[#c9d1d9] transition-colors hover:border-[#484f58]"
        >
          {mode === "best" ? (
            <>
              <span style={{ color: upColor }}>▲</span>
              <span>飆股模式</span>
              <span className="text-[#6e7681]">→ 切換砸盤</span>
            </>
          ) : (
            <>
              <span style={{ color: downColor }}>▼</span>
              <span>砸盤模式</span>
              <span className="text-[#6e7681]">→ 切換飆股</span>
            </>
          )}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-20 text-center text-sm text-[#6e7681]">載入中...</div>
      ) : figures.length === 0 ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] py-20 text-center">
          <p className="text-sm text-[#6e7681]">此期間暫無足夠資料</p>
          <p className="mt-1 text-xs text-[#484f58]">需要至少兩個不同日期的價格快照</p>
        </div>
      ) : (
        <div>
        {isFallback && (
          <div className="mb-3 rounded-lg border border-[#C4A265]/30 bg-[#C4A265]/5 px-4 py-2 text-xs text-[#C4A265]">
            此期間無新交易資料，目前顯示所有公仔與定價的比較排行
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363d] bg-[#161b22]">
                <th className="px-2 py-2 text-left text-[10px] font-medium text-[#8b949e] sm:px-3 sm:py-2.5 sm:text-xs">#</th>
                <th className="px-2 py-2 text-left text-[10px] font-medium text-[#8b949e] sm:px-3 sm:py-2.5 sm:text-xs">公仔</th>
                <th className="px-2 py-2 text-right text-[10px] font-medium text-[#8b949e] sm:px-3 sm:py-2.5 sm:text-xs">現價</th>
                <th className="hidden px-2 py-2 text-right text-[10px] font-medium text-[#8b949e] sm:table-cell sm:px-3 sm:py-2.5 sm:text-xs">前價</th>
                <th className="px-2 py-2 text-right text-[10px] font-medium text-[#8b949e] sm:px-3 sm:py-2.5 sm:text-xs">漲跌幅</th>
                <th className="hidden px-3 py-2.5 text-right text-xs font-medium text-[#8b949e] sm:table-cell">vs 定價</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((fig, i) => {
                const isPositive = (fig.change_pct ?? 0) >= 0;
                const color = isPositive ? upColor : downColor;
                const arrow = isPositive ? "▲" : "▼";
                return (
                  <tr key={fig.id} className="border-b border-[#21262d] transition-colors hover:bg-[#161b22]">
                    <td className="px-2 py-2.5 text-xs text-[#6e7681] sm:px-3 sm:text-sm">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/figures/${fig.id}`} className="flex items-center gap-2 hover:opacity-80">
                        {fig.image_url && (
                          <img src={fig.image_url} alt="" className="h-8 w-8 shrink-0 rounded border border-[#30363d] object-contain sm:h-10 sm:w-10" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[#c9d1d9] sm:text-sm">{fig.name}</p>
                          <p className="truncate text-[10px] text-[#6e7681]">{fig.manufacturer || "未知"}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-medium text-[#c9d1d9] sm:px-3 sm:text-sm">
                      {fig.current_median_price ? fmt(fig.current_median_price, currency) : "--"}
                    </td>
                    <td className="hidden whitespace-nowrap px-2 py-2.5 text-right text-xs text-[#8b949e] sm:table-cell sm:px-3 sm:text-sm">
                      {fig.previous_price ? fmt(fig.previous_price, currency) : "--"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right sm:px-3">
                      <span style={{ color }} className="text-xs font-bold sm:text-sm">
                        {arrow} {Math.abs(fig.change_pct ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                      {fig.vs_retail_pct != null ? (
                        <span style={{ color: fig.vs_retail_pct >= 0 ? upColor : downColor }} className="text-xs">
                          {fig.vs_retail_pct >= 0 ? "▲" : "▼"} {Math.abs(fig.vs_retail_pct).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[#484f58]">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
