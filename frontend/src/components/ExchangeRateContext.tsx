"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface ExchangeRates {
  USD: number;
  TWD: number;
  JPY: number;
  CNY: number;
  updated_at?: string | null;
}

const DEFAULT_RATES: ExchangeRates = { USD: 1, TWD: 32.2, JPY: 149.5, CNY: 7.25 };

const ExchangeRateContext = createContext<ExchangeRates>(DEFAULT_RATES);

export function ExchangeRateProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<ExchangeRates>(DEFAULT_RATES);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${apiUrl}/browse/exchange-rates`)
      .then(r => r.json())
      .then(data => {
        if (data.USD && data.TWD && data.JPY && data.CNY) {
          setRates({ USD: data.USD, TWD: data.TWD, JPY: data.JPY, CNY: data.CNY, updated_at: data.updated_at });
        }
      })
      .catch(() => {});  // fallback to defaults
  }, []);

  return <ExchangeRateContext value={rates}>{children}</ExchangeRateContext>;
}

export function useExchangeRates(): ExchangeRates {
  return useContext(ExchangeRateContext);
}

// Helper: convert from one currency to USD
export function toUSD(amount: number, fromCurrency: string, rates: ExchangeRates): number {
  const rate = (rates as unknown as Record<string, number>)[fromCurrency] || 1;
  return amount / rate;
}

// Helper: convert USD to display currency
export function fromUSD(usd: number, toCurrency: string, rates: ExchangeRates): number {
  const rate = (rates as unknown as Record<string, number>)[toCurrency] || 1;
  return usd * rate;
}

// Helper: convert between any two currencies
export function convertCurrency(amount: number, from: string, to: string, rates: ExchangeRates): number {
  if (from === to) return amount;
  const usd = toUSD(amount, from, rates);
  return fromUSD(usd, to, rates);
}
