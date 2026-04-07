"use client";

import Link from "next/link";
import { useColorMode } from "./ColorModeContext";
import WatchlistButton from "./WatchlistButton";

interface FigureCardProps {
  id: number;
  name: string;
  manufacturer?: string;
  image_url?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
  currency: string;
}

function formatPrice(priceUsd: number, currency: string): string {
  const rates: Record<string, number> = { USD: 1, TWD: 32.2, JPY: 149.5, CNY: 7.25 };
  const symbols: Record<string, string> = { TWD: "$", JPY: "\u00a5", USD: "$", CNY: "\u00a5" };
  const rate = rates[currency] || 1;
  const converted = priceUsd * rate;
  const symbol = symbols[currency] || "$";
  return `${symbol}${Math.round(converted).toLocaleString()}`;
}

function formatRetailPrice(price: number, fromCurrency: string, toCurrency: string): string {
  const rates: Record<string, number> = { USD: 1, TWD: 32.2, JPY: 149.5, CNY: 7.25 };
  const symbols: Record<string, string> = { TWD: "$", JPY: "\u00a5", USD: "$", CNY: "\u00a5" };
  // Convert from original currency to USD, then to display currency
  const fromRate = rates[fromCurrency] || 149.5;
  const toRate = rates[toCurrency] || 1;
  const priceUsd = price / fromRate;
  const converted = priceUsd * toRate;
  const symbol = symbols[toCurrency] || "$";
  return `${symbol}${Math.round(converted).toLocaleString()}`;
}

export default function FigureCard({ id, name, manufacturer, image_url, retail_price, retail_currency, current_median_price, price_change_pct, currency }: FigureCardProps) {
  const { upColor, downColor } = useColorMode();

  const hasPrice = current_median_price != null;
  const isUp = price_change_pct != null && price_change_pct >= 0;
  const isDown = price_change_pct != null && price_change_pct < 0;
  const priceColor = isUp ? upColor : isDown ? downColor : "#C4A265";

  return (
    <Link
      href={`/figures/${id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] transition-shadow hover:border-[#484f58]"
    >
      {/* Watchlist heart overlay */}
      <div className="absolute top-2 right-2 z-10">
        <WatchlistButton figureId={id} size="sm" />
      </div>

      {image_url ? (
        <div className="aspect-[4/5] overflow-hidden bg-[#0d1117]">
          <img src={image_url} alt={name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        </div>
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-[#0d1117] text-xs text-[#484f58]">No Image</div>
      )}
      <div className="p-2 sm:p-2.5">
        {/* Fixed-height name area: 2 lines max */}
        <p className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 sm:text-xs text-[#c9d1d9]">{name}</p>
        {/* Manufacturer: always 1 line */}
        <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-[#6e7681]">{manufacturer || "未知製造商"}</p>
        {/* Price: always 1 line */}
        <div className="mt-1 flex h-5 items-center gap-1">
          {hasPrice ? (
            <>
              {price_change_pct != null && (
                <span style={{ color: priceColor }} className="text-[10px]">
                  {isUp ? "▲" : "▼"}
                </span>
              )}
              <span style={{ color: priceColor }} className="text-xs font-semibold">
                {formatPrice(current_median_price, currency)}
              </span>
            </>
          ) : retail_price ? (
            <span className="text-xs font-semibold text-[#6e7681]">
              定價 {formatRetailPrice(retail_price, retail_currency || "JPY", currency)}
            </span>
          ) : (
            <span className="text-[10px] text-[#484f58]">暫無價格</span>
          )}
        </div>
      </div>
    </Link>
  );
}
