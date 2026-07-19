"use client";

import Link from "next/link";
import { useColorMode } from "./ColorModeContext";
import WatchlistButton from "./WatchlistButton";
import ImageWithFallback from "./ImageWithFallback";
import { useExchangeRates } from "./ExchangeRateContext";
import { convertCurrency, formatCurrency } from "@/lib/currency";

interface FigureCardProps {
  id: number;
  name: string;
  manufacturer?: string;
  image_url?: string;
  retail_price?: number;
  retail_currency?: string;
  /** Median price already converted to `currency` by the backend (search/trending/related
   *  endpoints all accept `?currency=`). Frontend just formats with the right symbol. */
  current_median_price?: number;
  price_change_pct?: number;
  /** Display currency — used for the symbol and (only as a hint) for the retail fallback. */
  currency: string;
}

export default function FigureCard({
  id,
  name,
  manufacturer,
  image_url,
  retail_price,
  retail_currency,
  current_median_price,
  price_change_pct,
  currency,
}: FigureCardProps) {
  const { upColor, downColor } = useColorMode();
  const liveRates = useExchangeRates() as unknown as Record<string, number>;

  const hasPrice = current_median_price != null;
  const isUp = price_change_pct != null && price_change_pct >= 0;
  const isDown = price_change_pct != null && price_change_pct < 0;
  const priceColor = isUp ? upColor : isDown ? downColor : "#C4A265";

  const renderPrice = () => {
    if (hasPrice) {
      return (
        <>
          {price_change_pct != null && (
            <span style={{ color: priceColor }} className="text-[10px]">
              {isUp ? "▲" : "▼"}
            </span>
          )}
          <span style={{ color: priceColor }} className="text-xs font-semibold">
            {formatCurrency(current_median_price!, currency)}
          </span>
        </>
      );
    }
    // No market price yet — fall back to retail, converted to the user's display
    // currency so cards render consistently regardless of the source listing's currency.
    if (retail_price && retail_currency) {
      const retailDisplay = convertCurrency(retail_price, retail_currency, currency, liveRates);
      return (
        <span className="text-xs font-semibold text-[#6e7681]">
          定價 {formatCurrency(retailDisplay, currency)}
        </span>
      );
    }
    return <span className="text-[10px] text-[#484f58]">暫無價格</span>;
  };

  return (
    <Link
      href={`/figures/${id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] transition-shadow hover:border-[#484f58]"
    >
      {/* Watchlist heart overlay */}
      <div className="absolute top-2 right-2 z-10">
        <WatchlistButton figureId={id} size="sm" />
      </div>

      <div className="aspect-[4/5] overflow-hidden bg-[#0d1117]">
        <ImageWithFallback
          src={image_url}
          alt={name}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <div className="p-2 sm:p-2.5">
        <p className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 sm:text-xs text-[#c9d1d9]">{name}</p>
        <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-[#6e7681]">{manufacturer || "未知製造商"}</p>
        <div className="mt-1 flex h-5 items-center gap-1">{renderPrice()}</div>
      </div>
    </Link>
  );
}
