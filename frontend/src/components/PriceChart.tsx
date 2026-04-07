"use client";

import { useState, useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Line,
  Scatter,
} from "recharts";
import { format, parseISO, subDays, subMonths, subYears } from "date-fns";

interface PriceDataPoint {
  date: string;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
}

interface Listing {
  id: number;
  price: number;
  price_usd?: number;
  currency: string;
  condition: string;
  sold_at?: string;
  source: string;
  title?: string;
}

interface PriceChartProps {
  data: PriceDataPoint[];
  dataByCondition?: Record<string, PriceDataPoint[]>;
  listings?: Listing[];
  currency?: string;
}

type TimeRange = "7d" | "1m" | "3m" | "6m" | "1y" | "all";
type ConditionTab = "all" | "sealed" | "opened" | "used" | "damaged";

const EXCHANGE_RATES: Record<string, number> = { USD: 1, TWD: 32.2, JPY: 149.5, CNY: 7.25 };
const CURRENCY_SYMBOLS: Record<string, string> = { TWD: "NT$", JPY: "\u00a5", USD: "$", CNY: "\u00a5" };

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: "7d", label: "7天" },
  { key: "1m", label: "1月" },
  { key: "3m", label: "3月" },
  { key: "6m", label: "6月" },
  { key: "1y", label: "1年" },
  { key: "all", label: "全部" },
];

const CONDITION_TABS: { key: ConditionTab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "sealed", label: "未拆" },
  { key: "opened", label: "拆檢" },
  { key: "used", label: "拆擺" },
  { key: "damaged", label: "瑕疵" },
];

function getStartDate(range: TimeRange): Date | null {
  const now = new Date();
  switch (range) {
    case "7d": return subDays(now, 7);
    case "1m": return subMonths(now, 1);
    case "3m": return subMonths(now, 3);
    case "6m": return subMonths(now, 6);
    case "1y": return subYears(now, 1);
    case "all": return null;
  }
}

function formatCurrencyValue(val: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] || "$";
  if (currency === "JPY") return `${sym}${Math.round(val).toLocaleString()}`;
  return `${sym}${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatTickValue(val: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] || "$";
  if (val >= 10000) {
    const k = val / 1000;
    return `${sym}${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${sym}${Math.round(val).toLocaleString()}`;
}

function CustomTooltip({
  active, payload, label, currency,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const colorMap: Record<string, { label: string; color: string }> = {
    avg_price: { label: "平均", color: "#C4A265" },
    median_price: { label: "中位數", color: "#c9d1d9" },
    max_price: { label: "最高", color: "#3fb950" },
    min_price: { label: "最低", color: "#f85149" },
    listing_price: { label: "成交", color: "#e6edf3" },
  };
  return (
    <div style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" }}>
      <p style={{ color: "#c9d1d9", margin: "0 0 4px 0" }}>{label}</p>
      {payload.map((entry) => {
        const mapping = colorMap[entry.dataKey];
        if (!mapping) return null;
        return (
          <p key={entry.dataKey} style={{ color: mapping.color, margin: "2px 0", fontWeight: 500 }}>
            {mapping.label}: {typeof entry.value === "number" ? formatCurrencyValue(entry.value, currency) : entry.value}
          </p>
        );
      })}
    </div>
  );
}

export default function PriceChart({ data, dataByCondition, listings, currency = "TWD" }: PriceChartProps) {
  const [range, setRange] = useState<TimeRange>("all");
  const [condTab, setCondTab] = useState<ConditionTab>("all");

  // Determine which conditions have data
  const availableConditions = useMemo(() => {
    if (!dataByCondition) return ["all"];
    return CONDITION_TABS.map(t => t.key).filter(k => {
      const d = k === "all" ? data : dataByCondition[k];
      return d && d.length > 0;
    });
  }, [data, dataByCondition]);

  // Get data for current condition tab
  const condData = useMemo(() => {
    if (condTab === "all") return data;
    if (!dataByCondition || !dataByCondition[condTab]) return [];
    return dataByCondition[condTab];
  }, [condTab, data, dataByCondition]);

  const filtered = useMemo(() => {
    if (!condData || condData.length === 0) return [];
    const start = getStartDate(range);
    if (!start) return condData;
    return condData.filter((d) => parseISO(d.date) >= start);
  }, [condData, range]);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[#6e7681]">
        尚無價格走勢資料
      </div>
    );
  }

  const chartData = range === "all" ? condData : filtered;
  // Note: mergedData is used below for the actual chart rendering
  const rate = EXCHANGE_RATES[currency] || 1;

  const formatted = (chartData || []).map((d) => ({
    dateLabel: format(parseISO(d.date), "yyyy/MM/dd"),
    avg_price: d.avg_price * rate,
    median_price: d.median_price * rate,
    min_price: d.min_price * rate,
    max_price: d.max_price * rate,
  }));

  const isSinglePoint = formatted.length === 1;

  // Individual listing dots (transactions)
  const listingDots = useMemo(() => {
    if (!listings || listings.length === 0) return [];
    const condLabels: Record<string, string> = { sealed: "全新", opened: "拆檢", used: "拆擺", damaged: "瑕疵" };
    return listings
      .filter(l => {
        if (!l.sold_at && !l.price_usd) return false;
        // Filter by condition tab
        if (condTab !== "all" && l.condition !== condTab) return false;
        // Filter by time range
        const rangeStart = getStartDate(range);
        if (rangeStart) {
          const d = l.sold_at ? new Date(l.sold_at) : new Date();
          if (d < rangeStart) return false;
        }
        return true;
      })
      .map(l => {
        const d = l.sold_at ? new Date(l.sold_at) : new Date();
        const dateLabel = format(d, "yyyy/MM/dd");
        const priceUsd = l.price_usd || (l.price / (EXCHANGE_RATES[l.currency] || 1));
        return {
          dateLabel,
          listing_price: priceUsd * rate,
          condition: condLabels[l.condition] || l.condition,
          source: l.source,
          title: l.title || "",
        };
      });
  }, [listings, condTab, rate, range]);

  // Merge listing dates into chart data for a unified timeline
  const mergedData = useMemo(() => {
    if (listingDots.length === 0) return formatted;
    const dateMap = new Map<string, any>();
    for (const d of formatted) {
      dateMap.set(d.dateLabel, { ...d });
    }
    for (const dot of listingDots) {
      if (!dateMap.has(dot.dateLabel)) {
        dateMap.set(dot.dateLabel, { dateLabel: dot.dateLabel });
      }
      const existing = dateMap.get(dot.dateLabel)!;
      // Store listing prices as an array for this date
      if (!existing.listing_prices) existing.listing_prices = [];
      existing.listing_prices.push(dot.listing_price);
      // Use the first listing price as the scatter point
      existing.listing_price = dot.listing_price;
    }
    const sorted = Array.from(dateMap.values()).sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));
    
    // Connect all dots: fill avg_price/median_price from listing_price where missing
    // This ensures the Line component draws through listing dots too
    for (const entry of sorted) {
      if (entry.listing_price && !entry.avg_price) {
        entry.avg_price = entry.listing_price;
        entry.median_price = entry.listing_price;
        entry.min_price = entry.listing_price;
        entry.max_price = entry.listing_price;
      }
    }
    
    // Carry forward: if last data point is before today, add a phantom point at today
    if (sorted.length > 0) {
      const todayLabel = format(new Date(), "yyyy/MM/dd");
      const last = sorted[sorted.length - 1];
      if (last.dateLabel < todayLabel) {
        // Copy the last known prices as a carried-forward point
        sorted.push({
          dateLabel: todayLabel,
          avg_price: last.avg_price || last.listing_price,
          median_price: last.median_price || last.listing_price,
          min_price: last.min_price,
          max_price: last.max_price,
          carried_forward: true, // flag for dashed line styling
        });
      }
    }
    
    return sorted;
  }, [formatted, listingDots]);

  const allValues = mergedData.flatMap((d) => [d.min_price, d.max_price, d.avg_price, d.median_price, d.listing_price].filter(v => v != null));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.1 || maxVal * 0.1 || 10;
  const yDomain = [Math.max(0, Math.floor(minVal - padding)), Math.ceil(maxVal + padding)];

  return (
    <div>
      {/* Condition tabs */}
      {availableConditions.length > 1 && (
        <div className="mb-2 flex items-center gap-1">
          {CONDITION_TABS.filter(t => availableConditions.includes(t.key)).map((t) => (
            <button
              key={t.key}
              onClick={() => setCondTab(t.key)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                condTab === t.key
                  ? "border-[#C4A265] bg-[#C4A265]/20 text-[#C4A265]"
                  : "border-[#30363d] text-[#6e7681] hover:text-[#8b949e] hover:border-[#484f58]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Time range selector */}
      <div className="mb-3 flex items-center gap-1">
        {TIME_RANGES.map((tr) => (
          <button
            key={tr.key}
            onClick={() => setRange(tr.key)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              range === tr.key
                ? "bg-[#C4A265]/20 text-[#C4A265]"
                : "text-[#6e7681] hover:text-[#8b949e] hover:bg-[#161b22]"
            }`}
          >
            {tr.label}
          </button>
        ))}
      </div>

      {mergedData.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-[#6e7681]">
          此狀態尚無價格資料
        </div>
      ) : (
        <div className="h-56 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mergedData} margin={{ top: 5, right: 10, left: 15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="dateLabel" stroke="#30363d" tick={{ fill: "#8b949e", fontSize: 11 }} interval={isSinglePoint ? 0 : "preserveStartEnd"} />
              <YAxis stroke="#30363d" tick={{ fill: "#8b949e", fontSize: 10 }} width={60} domain={yDomain} tickFormatter={(v: number) => formatTickValue(v, currency)} />
              <Tooltip content={<CustomTooltip currency={currency} />} />
              {!isSinglePoint && (
                <>
                  <Area type="monotone" dataKey="max_price" stroke="none" fill="rgba(196, 162, 101, 0.1)" fillOpacity={0.8} />
                  <Area type="monotone" dataKey="min_price" stroke="none" fill="#0d1117" fillOpacity={1} />
                  <Line type="monotone" dataKey="avg_price" stroke="#C4A265" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#C4A265" }} />
                  <Line type="monotone" dataKey="median_price" stroke="#8b949e" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 3, fill: "#8b949e" }} />
                </>
              )}
              {isSinglePoint && (
                <>
                  <Line type="monotone" dataKey="avg_price" stroke="#C4A265" strokeWidth={2} dot={{ r: 5, fill: "#C4A265", stroke: "#C4A265" }} />
                  <Line type="monotone" dataKey="median_price" stroke="#8b949e" strokeWidth={1.5} dot={{ r: 4, fill: "#8b949e", stroke: "#8b949e" }} />
                  <Line type="monotone" dataKey="max_price" stroke="#3fb950" strokeWidth={1} dot={{ r: 3, fill: "#3fb950", stroke: "#3fb950" }} />
                  <Line type="monotone" dataKey="min_price" stroke="#f85149" strokeWidth={1} dot={{ r: 3, fill: "#f85149", stroke: "#f85149" }} />
                </>
              )}
              {/* Individual transaction dots */}
              <Scatter dataKey="listing_price" fill="#C4A265" fillOpacity={0.8} shape="circle" r={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[#C4A265]" /><span className="text-[#8b949e]">平均</span></span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-[#8b949e]" /><span className="text-[#8b949e]">中位數</span></span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[#3fb950]/30" /><span className="text-[#8b949e]">最高</span></span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[#f85149]/30" /><span className="text-[#8b949e]">最低</span></span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#C4A265]" /><span className="text-[#8b949e]">成交</span></span>
      </div>
    </div>
  );
}
