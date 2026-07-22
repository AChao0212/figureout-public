"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/currency";
import CountUp from "./CountUp";

interface ConditionPrice {
  condition: string;
  condition_label: string;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  sample_count: number;
}

interface Props {
  prices: ConditionPrice[];
  currency: string;
  /** Overall figures across every condition — rendered as the leading
   *  「全部」 tab so the old separate 價格摘要 block is no longer needed. */
  overall?: {
    avg_price: number | null;
    median_price: number | null;
    min_price: number | null;
    max_price: number | null;
    sample_count?: number;
  } | null;
  /** Change against retail, shown under the headline number. */
  changePct?: number | null;
  retailLine?: string | null;
}

// Prices are already in `currency` (backend converts via /figures/{id}?currency=XXX).
// `formatCurrency` only adds the symbol, no rate math.
const fp = formatCurrency;
const show = (v: number | null | undefined, c: string) => (v != null ? fp(v, c) : "--");

/**
 * The one number a collector came for is the median, so it is the display
 * type; average / low / high sit under it as supporting columns, and the
 * condition tabs re-point all four. Label sits above value throughout, so no
 * line ever carries two text colours.
 */
export default function ConditionPriceTabs({
  prices,
  currency,
  overall,
  changePct,
  retailLine,
}: Props) {
  const tabs = [
    ...(overall
      ? [
          {
            condition: "__all__",
            condition_label: "全部",
            avg_price: overall.avg_price,
            median_price: overall.median_price,
            min_price: overall.min_price,
            max_price: overall.max_price,
            sample_count: overall.sample_count,
          },
        ]
      : []),
    ...prices,
  ];

  const [active, setActive] = useState(tabs[0]?.condition ?? "");
  const cp = tabs.find((t) => t.condition === active) || tabs[0];
  if (!cp) return null;

  const isUp = changePct != null && changePct >= 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--rule-faint)] pb-4">
        {tabs.map((t) => (
          <button
            key={t.condition}
            type="button"
            onClick={() => setActive(t.condition)}
            aria-pressed={active === t.condition}
            className="seg"
          >
            {t.condition_label}
          </button>
        ))}
      </div>

      <div className="pt-[clamp(18px,3vh,30px)]">
        <span className="lbl">
          中位成交價{cp.sample_count != null ? ` · ${cp.sample_count} 筆` : ""}
        </span>
        <CountUp
          value={cp.median_price}
          format={(v) => fp(v, currency)}
          className="num block text-[clamp(40px,6.4vw,72px)] font-light leading-[0.92] tracking-[-0.035em] text-[var(--ink)]"
        />

        {/* Direction respects the reader's 紅漲/綠漲 convention via --up/--down;
            this line used to hardcode green-for-up, contradicting the site default. */}
        {changePct != null && (
          <div className={`num mt-3.5 text-[12.5px] tracking-[0.04em] ${isUp ? "up" : "down"}`}>
            {isUp ? "+" : ""}
            {changePct.toFixed(1)}% 對定價
          </div>
        )}
        {retailLine && (
          <div className="mt-1.5 font-mono text-[11px] tracking-[0.06em] text-[var(--muted)]">
            {retailLine}
          </div>
        )}
      </div>

      <div className="mt-[clamp(20px,3.2vh,32px)] grid grid-cols-3 gap-x-6 border-t border-[var(--rule-faint)] pt-5">
        <div>
          <span className="lbl">平均</span>
          <CountUp value={cp.avg_price} format={(v) => fp(v, currency)} className="num block text-[15px] text-[var(--ink)]" />
        </div>
        <div>
          <span className="lbl">最低</span>
          <CountUp value={cp.min_price} format={(v) => fp(v, currency)} className="num block text-[15px] text-[var(--ink)]" />
        </div>
        <div>
          <span className="lbl">最高</span>
          <CountUp value={cp.max_price} format={(v) => fp(v, currency)} className="num block text-[15px] text-[var(--ink)]" />
        </div>
      </div>
    </div>
  );
}
