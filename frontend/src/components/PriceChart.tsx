"use client";

import { useState, useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Scatter,
  ReferenceLine,
} from "recharts";
import { format, parseISO, subDays, subMonths, subYears } from "date-fns";
import { useExchangeRates } from "./ExchangeRateContext";
import {
 convertCurrency,
 formatCurrency,
 formatCurrencyTick,
} from "@/lib/currency";

interface PriceDataPoint {
 date: string;
 avg_price: number;
 median_price: number;
 min_price: number;
 max_price: number;
 sample_count?: number;
}

interface Listing {
 id: number;
 price: number;
 price_canonical?: number;
 currency: string;
 condition: string;
 sold_at?: string;
 source: string;
 title?: string;
}

interface PriceChartProps {
  /** Daily aggregates from the backend (already in display currency). Drives the trend line. */
 data: PriceDataPoint[];
 dataByCondition?: Record<string, PriceDataPoint[]>;
  /** Individual transactions. Rendered as small scatter dots showing the day's spread. */
 listings?: Listing[];
 currency?: string;
}

type TimeRange = "7d" | "1m" | "3m" | "6m" | "1y" | "all";
type ConditionTab = "all" | "sealed" | "opened" | "used" | "damaged";

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

const CONDITION_LABELS: Record<string, string> = {
 sealed: "全新", opened: "拆檢", used: "拆擺", damaged: "瑕疵",
};

const SOURCE_LABELS: Record<string, string> = {
 yahoo_auction: "Yahoo", mercari: "Mercari", mercari_jp: "Mercari",
 user_report: "社群回報", manual: "手動",
};

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

interface DailyAggregate {
 avg: number;
 median: number;
 min: number;
 max: number;
 count: number;
}

interface DailyListing {
 price: number;
 condition?: string;
 source?: string;
 title?: string;
}

/**
 * Each chart row contributes to one or more series:
 *  - `trend`        → trend line + gradient area (one row per day, plus a flat tail to today)
 *  - `listing_price` → scatter dot (one row per individual transaction)
 * A row may have both fields when a single listing is the day's only transaction.
 */
interface ChartRow {
 dateLabel: string;
 sortKey: string;
  /** Daily median, drives the trend line. Only set on a day's primary row + the today-tail row. */
 trend?: number;
  /** Individual transaction price, drives the scatter. Only set on per-listing rows. */
 listing_price?: number;
  /** Indicates the trailing "today" tail row, so we can hide its dot/tooltip. */
 isTail?: boolean;
  /** Per-row context for tooltips. */
 condition?: string;
 source?: string;
 title?: string;
 dailyAgg?: DailyAggregate;
  /** All listings on this day — populated on every row so any hover shows full context. */
 dayListings?: DailyListing[];
}

/** Tooltip — same content regardless of whether the user hovers a trend dot or a scatter dot.
 *  Single-listing days show the listing's full details. Multi-listing days show the day's
 * aggregate stats plus a compact list of every transaction. */
function CustomTooltip({
 active, payload, currency,
}: {
 active?: boolean;
 payload?: Array<{ payload: ChartRow }>;
 currency: string;
}) {
 if (!active || !payload || payload.length === 0) return null;
 const row = payload[0].payload;
 if (row.isTail) return null; // never show tooltip on the carry-forward tail

 const agg = row.dailyAgg;
 const dayListings = row.dayListings ?? [];
 const isMultiDay = (agg?.count ?? dayListings.length) > 1;
  // For single-listing days, prefer the listing's own metadata if the row carries it
  // (i.e. user hovered the scatter dot); otherwise pull from dayListings[0].
 const single = !isMultiDay
    ? {
 price: row.listing_price ?? dayListings[0]?.price ?? row.trend,
 condition: row.condition ?? dayListings[0]?.condition,
 source: row.source ?? dayListings[0]?.source,
 title: row.title ?? dayListings[0]?.title,
      }
    : null;

 return (
    <div style={{
 backgroundColor: "var(--ground-lift)", border: "1px solid var(--rule)",
 borderRadius: "8px", padding: "8px 12px", fontSize: "12px",
 maxWidth: 280,
    }}>
      <p style={{ color: "var(--ink-2)", margin: "0 0 4px 0", fontSize: "11px" }}>
        {row.dateLabel}
      </p>

      {single && (
        <>
          {single.price != null && (
            <p style={{ color: "var(--ink)", margin: "2px 0", fontWeight: 600, fontSize: "13px" }}>
              成交：{formatCurrency(single.price, currency)}
            </p>
          )}
          {single.condition && (
            <p style={{ color: "var(--ink)", margin: "2px 0", fontSize: "11px" }}>
              狀態：{single.condition}
            </p>
          )}
          {single.source && (
            <p style={{ color: "var(--ink)", margin: "2px 0", fontSize: "11px" }}>
              來源：{single.source}
            </p>
          )}
          {single.title && (
            <p style={{
 color: "var(--ink-2)", margin: "4px 0 0 0", fontSize: "10px",
 maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
 whiteSpace: "nowrap",
            }}>
              {single.title}
            </p>
          )}
        </>
      )}

      {isMultiDay && agg && (
        <>
          <p style={{ color: "var(--muted)", margin: "0 0 3px 0", fontSize: "10px" }}>
            當日 {agg.count} 筆
          </p>
          <p style={{ color: "var(--ink)", margin: "1px 0", fontSize: "11px" }}>
            中位數 {formatCurrency(agg.median, currency)}
          </p>
          <p style={{ color: "var(--ink)", margin: "1px 0", fontSize: "11px" }}>
            平均 {formatCurrency(agg.avg, currency)}
          </p>
          <p style={{ color: "var(--hue-green)", margin: "1px 0", fontSize: "11px" }}>
            最高 {formatCurrency(agg.max, currency)}
          </p>
          <p style={{ color: "var(--hue-red)", margin: "1px 0", fontSize: "11px" }}>
            最低 {formatCurrency(agg.min, currency)}
          </p>
          {dayListings.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ground-lift)" }}>
              <p style={{ color: "var(--muted)", margin: "0 0 3px 0", fontSize: "10px" }}>
                成交紀錄
              </p>
              {dayListings.slice(0, 6).map((l, i) => (
                <p key={i} style={{ color: "var(--ink)", margin: "1px 0", fontSize: "10px" }}>
                  {formatCurrency(l.price, currency)}
                  {l.condition ? ` · ${l.condition}` : ""}
                  {l.source ? ` · ${l.source}` : ""}
                </p>
              ))}
              {dayListings.length > 6 && (
                <p style={{ color: "var(--muted)", margin: "1px 0", fontSize: "10px" }}>
                  …等 {dayListings.length} 筆
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PriceChart({ data, dataByCondition, listings, currency = "TWD" }: PriceChartProps) {
 const [range, setRange] = useState<TimeRange>("all");
 const [condTab, setCondTab] = useState<ConditionTab>("all");
 const liveRates = useExchangeRates() as unknown as Record<string, number>;

 const availableConditions = useMemo(() => {
 if (!dataByCondition) return ["all"];
 return CONDITION_TABS.map(t => t.key).filter(k => {
 const d = k === "all" ? data : dataByCondition[k];
 return d && d.length > 0;
    });
  }, [data, dataByCondition]);

 const condData = useMemo(() => {
 if (condTab === "all") return data;
 return dataByCondition?.[condTab] ?? [];
  }, [condTab, data, dataByCondition]);

  // Filter aggregates and listings to the active time range in one place.
 const start = getStartDate(range);

  // Daily aggregates that fall inside the time range, sorted ascending.
 const filteredAggregates = useMemo(() => {
 return (condData ?? [])
      .filter(d => !start || parseISO(d.date) >= start)
      .map(d => ({
 dateLabel: format(parseISO(d.date), "yyyy/MM/dd"),
 sortKey: d.date,
 agg: {
 avg: d.avg_price,
 median: d.median_price,
 min: d.min_price,
 max: d.max_price,
 count: d.sample_count ?? 1,
        } as DailyAggregate,
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [condData, start]);

  // Group listings by date so per-day scatter rows can pull the right day's aggregate
  // for tooltips without re-fetching it.
 const listingsByDate = useMemo(() => {
 const map = new Map<string, DailyListing[]>();
 if (!listings) return map;
 for (const l of listings) {
 if (condTab !== "all" && l.condition !== condTab) continue;
 const d = l.sold_at ? new Date(l.sold_at) : null;
 if (!d) continue;
 if (start && d < start) continue;
 const dateLabel = format(d, "yyyy/MM/dd");
 const arr = map.get(dateLabel) ?? [];
 arr.push({
 price: convertCurrency(l.price, l.currency, currency, liveRates),
 condition: CONDITION_LABELS[l.condition] || l.condition,
 source: SOURCE_LABELS[l.source] || l.source,
 title: l.title,
      });
 map.set(dateLabel, arr);
    }
 return map;
  }, [listings, condTab, start, currency, liveRates]);

  // Unified data array with two series interleaved:
  //  - One row per day with `trend` set (drives the line + area).
  //  - One row per listing with `listing_price` set (drives the scatter).
  //  - A trailing "today" row carries the last median forward as a flat tail (no dot).
 const chartRows = useMemo<ChartRow[]>(() => {
 const rows: ChartRow[] = [];
 const aggByDate = new Map(filteredAggregates.map(a => [a.dateLabel, a.agg]));

 for (const a of filteredAggregates) {
 rows.push({
 dateLabel: a.dateLabel,
 sortKey: a.sortKey,
 trend: a.agg.median,
 dailyAgg: a.agg,
 dayListings: listingsByDate.get(a.dateLabel) ?? [],
      });
    }

 for (const [dateLabel, dayListings] of listingsByDate.entries()) {
 const agg = aggByDate.get(dateLabel);
 const sortKey = filteredAggregates.find(a => a.dateLabel === dateLabel)?.sortKey ?? dateLabel;
 for (const l of dayListings) {
 rows.push({
 dateLabel,
 sortKey: sortKey + "_dot",
 listing_price: l.price,
 condition: l.condition,
 source: l.source,
 title: l.title,
 dailyAgg: agg,
 dayListings,
        });
      }
    }

 rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // Carry the last median forward to today so the trend line reaches the right edge.
    // The tail row holds no scatter and is invisible (no dot, no tooltip), so it doesn't
    // imply that a transaction happened today.
 if (filteredAggregates.length > 0) {
 const lastAgg = filteredAggregates[filteredAggregates.length - 1];
 const todayLabel = format(new Date(), "yyyy/MM/dd");
 if (lastAgg.dateLabel < todayLabel) {
 rows.push({
 dateLabel: todayLabel,
 sortKey: new Date().toISOString(),
 trend: lastAgg.agg.median,
 isTail: true,
        });
      }
    }

 return rows;
  }, [filteredAggregates, listingsByDate]);

  // X-axis ticks: each unique date once, in chronological order.
 const uniqueDates = useMemo(() => {
 const seen = new Set<string>();
 const result: string[] = [];
 for (const r of chartRows) {
 if (!seen.has(r.dateLabel)) {
 seen.add(r.dateLabel);
 result.push(r.dateLabel);
      }
    }
 return result;
  }, [chartRows]);

 if (!data || data.length === 0) {
 return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--muted)]">
        尚無價格走勢資料
      </div>
    );
  }

  // Y-axis domain spans every value the user can see — trend line, scatter dots,
  // and the tooltip's max/min — so nothing falls outside the visible area.
 const allValues = chartRows.flatMap(r => {
 const vs: number[] = [];
 if (r.trend != null) vs.push(r.trend);
 if (r.listing_price != null) vs.push(r.listing_price);
 if (r.dailyAgg) vs.push(r.dailyAgg.min, r.dailyAgg.max);
 return vs;
  });
 const minVal = allValues.length ? Math.min(...allValues) : 0;
 const maxVal = allValues.length ? Math.max(...allValues) : 0;
 const padding = (maxVal - minVal) * 0.1 || maxVal * 0.1 || 10;
 const yDomain = [Math.max(0, Math.floor(minVal - padding)), Math.ceil(maxVal + padding)];

  // Find the dateLabel of the last actual data point — used to draw a subtle vertical
  // marker separating real history from the "today" tail.
 const lastActualLabel = filteredAggregates.length > 0
    ? filteredAggregates[filteredAggregates.length - 1].dateLabel
    : null;

 return (
    <div>
      {/* Condition tabs */}
      {availableConditions.length > 1 && (
        <div className="mb-2 flex items-center gap-1">
          {CONDITION_TABS.filter(t => availableConditions.includes(t.key)).map((t) => (
            <button
 key={t.key}
 onClick={() => setCondTab(t.key)}
 className={` border px-2.5 py-1 text-[11px] font-medium transition-colors ${
 condTab === t.key
                  ? "border-[var(--ink)] bg-[var(--ink)]/20 text-[var(--ink)]"
                  : "border-[var(--rule)] text-[var(--muted)] hover:text-[var(--ink-2)] hover:border-[var(--muted)]"
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
 className={` px-2.5 py-1 text-[11px] font-medium transition-colors ${
 range === tr.key
                ? "bg-[var(--ink)]/20 text-[var(--ink)]"
                : "text-[var(--muted)] hover:text-[var(--ink-2)] hover:bg-[var(--ground-lift)]"
            }`}
          >
            {tr.label}
          </button>
        ))}
      </div>

      {chartRows.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-[var(--muted)]">
          此狀態尚無價格資料
        </div>
      ) : (
        <div className="h-56 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 5, right: 10, left: 15, bottom: 0 }}>
              <defs>
                <linearGradient id="priceTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ground-lift)" />
              <XAxis
 dataKey="dateLabel"
 stroke="var(--rule)"
 tick={{ fill: "var(--ink-2)", fontSize: 11 }}
 type="category"
 allowDuplicatedCategory={false}
 ticks={uniqueDates}
 interval="preserveStartEnd"
 minTickGap={30}
              />
              <YAxis
 stroke="var(--rule)"
 tick={{ fill: "var(--ink-2)", fontSize: 10 }}
 width={60}
 domain={yDomain}
 tickFormatter={(v: number) => formatCurrencyTick(v, currency)}
              />
              <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: "var(--rule)", strokeDasharray: "3 3" }} />

              {/* Soft gradient fill under the trend line. Connects across days so the area
 spans the full range, including the carry-forward tail. */}
              <Area
 type="monotone"
 dataKey="trend"
 stroke="none"
 fill="url(#priceTrendFill)"
 connectNulls
 isAnimationActive={false}
              />

              {/* Trend line through daily medians. Connects across listing-only rows
                  (which have null `trend`) and reaches today via the tail row. */}
              <Line
 type="monotone"
 dataKey="trend"
 stroke="var(--ink)"
 strokeWidth={2}
 dot={(props) => {
 const { payload, cx, cy } = props as unknown as { payload: ChartRow; cx: number; cy: number };
 if (payload.isTail || payload.trend == null) {
                    // Recharts requires an SVG element; render an invisible marker.
 return <circle key={`d-${payload.sortKey}`} cx={cx} cy={cy} r={0} fill="transparent" />;
                  }
 return <circle key={`d-${payload.sortKey}`} cx={cx} cy={cy} r={3.5} fill="var(--ink)" stroke="var(--ground)" strokeWidth={1.5} />;
                }}
 activeDot={{ r: 5, fill: "var(--ink)", stroke: "var(--ground)", strokeWidth: 2 }}
 connectNulls
 isAnimationActive={false}
              />

              {/* Individual transaction dots — small and translucent so they
 enrich the picture without competing with the trend line. */}
              <Scatter
 dataKey="listing_price"
 fill="var(--ink)"
 fillOpacity={0.45}
 shape="circle"
 isAnimationActive={false}
              />

              {/* Subtle marker at the boundary between actual data and the today-tail. */}
              {lastActualLabel && lastActualLabel !== uniqueDates[uniqueDates.length - 1] && (
                <ReferenceLine x={lastActualLabel} stroke="var(--rule)" strokeDasharray="3 3" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[var(--ink)]" />
          <span className="text-[var(--ink-2)]">趨勢（每日中位數）</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ink)]/60" />
          <span className="text-[var(--ink-2)]">個別成交</span>
        </span>
        <span className="text-[var(--muted)]">滑鼠移上去看更多</span>
      </div>
    </div>
  );
}
