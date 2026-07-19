"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { EXCHANGE_RATES, convertCurrency as _convertCurrency } from "@/lib/currency";

export interface ExchangeRates {
  USD: number;
  TWD: number;
  JPY: number;
  CNY: number;
  updated_at?: string | null;
}

const DEFAULT_RATES: ExchangeRates = {
  USD: EXCHANGE_RATES.USD,
  TWD: EXCHANGE_RATES.TWD,
  JPY: EXCHANGE_RATES.JPY,
  CNY: EXCHANGE_RATES.CNY,
};

const ExchangeRateContext = createContext<ExchangeRates>(DEFAULT_RATES);

export function ExchangeRateProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<ExchangeRates>(DEFAULT_RATES);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${apiUrl}/browse/exchange-rates`)
      .then((r) => r.json())
      .then((data) => {
        if (data.USD && data.TWD && data.JPY && data.CNY) {
          setRates({
            USD: data.USD,
            TWD: data.TWD,
            JPY: data.JPY,
            CNY: data.CNY,
            updated_at: data.updated_at,
          });
        }
      })
      .catch(() => {}); // fallback to defaults
  }, []);

  return <ExchangeRateContext value={rates}>{children}</ExchangeRateContext>;
}

export function useExchangeRates(): ExchangeRates {
  return useContext(ExchangeRateContext);
}

// Backward-compat re-exports — implementation lives in @/lib/currency.
// New code should import directly from "@/lib/currency".
export function convertCurrency(amount: number, from: string, to: string, rates: ExchangeRates): number {
  return _convertCurrency(amount, from, to, rates as unknown as Record<string, number>);
}

export function toUSD(amount: number, fromCurrency: string, rates: ExchangeRates): number {
  return _convertCurrency(amount, fromCurrency, "USD", rates as unknown as Record<string, number>);
}

export function fromUSD(usd: number, toCurrency: string, rates: ExchangeRates): number {
  return _convertCurrency(usd, "USD", toCurrency, rates as unknown as Record<string, number>);
}
