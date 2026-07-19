"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/currency";

interface ConditionPrice {
  condition: string;
  condition_label: string;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  sample_count: number;
}

// Prices are already in `currency` (backend converts via /figures/{id}?currency=XXX).
// `formatCurrency` only adds the symbol, no rate math.
const fp = formatCurrency;

export default function ConditionPriceTabs({ prices, currency }: { prices: ConditionPrice[]; currency: string }) {
  const [active, setActive] = useState(prices[0]?.condition || "sealed");
  const cp = prices.find(p => p.condition === active) || prices[0];

  if (!cp) return null;

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">各狀態價格</h2>
        <span className="rounded-full bg-[#0d1117] px-2 py-0.5 text-[10px] text-[#6e7681]">{cp.sample_count} 筆</span>
      </div>

      {/* Condition tabs */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
        {prices.map((p) => (
          <button
            key={p.condition}
            onClick={() => setActive(p.condition)}
            className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              active === p.condition
                ? "border-[#C4A265] bg-[#C4A265]/20 text-[#C4A265]"
                : "border-[#30363d] text-[#6e7681] hover:border-[#484f58] hover:text-[#8b949e]"
            }`}
          >
            {p.condition_label}
          </button>
        ))}
      </div>

      {/* Price grid — matches 價格摘要 layout */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-[#6e7681]">平均</p>
          <p className="text-base font-bold text-[#C4A265] sm:text-xl">{fp(cp.avg_price, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-[#6e7681]">中位數</p>
          <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">{fp(cp.median_price, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-[#6e7681]">最低</p>
          <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">{fp(cp.min_price, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-[#6e7681]">最高</p>
          <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">{fp(cp.max_price, currency)}</p>
        </div>
      </div>
    </div>
  );
}
