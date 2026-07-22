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

/**
 * A tile is an image, a name, a maker and a number — no frame, no fill, no
 * radius. The photograph is the only thing on the page allowed to carry
 * colour, so the surrounding chrome stays out of its way. Each caption line
 * holds exactly one text colour.
 */
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

  const renderPrice = () => {
    if (hasPrice) {
      // The whole line takes the direction colour, so the row still reads as
      // a single colour while the arrow keeps it legible without colour.
      const colour = isUp ? upColor : isDown ? downColor : undefined;
      return (
        <span className="p" style={colour ? { color: colour } : undefined}>
          {price_change_pct != null && (isUp ? "▲ " : "▼ ")}
          {formatCurrency(current_median_price!, currency)}
        </span>
      );
    }
    if (retail_price && retail_currency) {
      const retailDisplay = convertCurrency(retail_price, retail_currency, currency, liveRates);
      return <span className="p">定價 {formatCurrency(retailDisplay, currency)}</span>;
    }
    return <span className="p text-[var(--muted)]">暫無成交</span>;
  };

  return (
    <Link href={`/figures/${id}`} className="cell group">
      <figure className="shot">
        <ImageWithFallback src={image_url} alt={name} className="h-full w-full" compact />
        {/* revealed on hover / keyboard focus so the wall stays quiet at rest */}
        <span className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <WatchlistButton figureId={id} />
        </span>
      </figure>

      <div className="t">{name}</div>
      <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {manufacturer || "未知製造商"}
      </div>
      {renderPrice()}
    </Link>
  );
}
