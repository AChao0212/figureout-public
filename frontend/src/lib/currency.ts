/**
 * Centralized currency helpers — single source of truth for the frontend.
 *
 * Two scenarios:
 *
 *   1. Pre-converted values from the API (figure detail, etc.)
 *      → use `formatCurrency(amount, currency)` only (no rate math).
 *
 *   2. Raw individual listings or other places with mixed currencies
 *      → use `convertCurrency(price, fromCurrency, toCurrency, liveRates)` first,
 *        then `formatCurrency`. Same-currency short-circuits to the original number.
 *
 * The hardcoded `EXCHANGE_RATES` are the fallback. Live rates come from
 * `useExchangeRates()` (client) or `getLiveRatesServer()` (server-side fetch).
 */

export const VALID_CURRENCIES = ["USD", "TWD", "JPY", "CNY"] as const;
export type Currency = (typeof VALID_CURRENCIES)[number];

export const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  TWD: 32.2,
  JPY: 149.5,
  CNY: 7.25,
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  TWD: "NT$",
  JPY: "¥",
  USD: "$",
  CNY: "¥",
};

/** Format an already-converted price with the appropriate symbol.
 * JPY is rendered as a whole number; other currencies omit decimals too
 * (matching the existing UI). */
export function formatCurrency(price: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + " ";
  if (currency === "JPY") {
    return `${symbol}${Math.round(price).toLocaleString()}`;
  }
  return `${symbol}${price.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/** Format a tick value for chart axes — collapses 10k+ to "Xk" notation. */
export function formatCurrencyTick(price: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "$";
  if (price >= 10000) {
    const k = price / 1000;
    return `${symbol}${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${symbol}${Math.round(price).toLocaleString()}`;
}

/** Convert a price from `fromCurrency` to `toCurrency` using the supplied rates.
 * Same-currency short-circuits — no lossy USD round-trip.
 * If `rates` is omitted, uses the hardcoded fallback. */
export function convertCurrency(
  price: number,
  fromCurrency: string,
  toCurrency: string,
  rates?: Record<string, number>,
): number {
  if (fromCurrency === toCurrency) return price;
  const r = rates ?? EXCHANGE_RATES;
  const fromRate = r[fromCurrency] ?? EXCHANGE_RATES[fromCurrency] ?? 1;
  const toRate = r[toCurrency] ?? EXCHANGE_RATES[toCurrency] ?? 1;
  if (!fromRate) return price * toRate;
  return (price / fromRate) * toRate;
}
