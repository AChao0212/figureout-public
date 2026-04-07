import type { Metadata } from "next";
import PriceChart from "@/components/PriceChart";
import ListingsTable from "@/components/ListingsTable";
import ReportForm from "@/components/ReportForm";
import FigureNotes from "@/components/FigureNotes";
import TradingBoard from "@/components/TradingBoard";
import ErrorReportButton from "@/components/ErrorReportButton";
import PageTracker from "@/components/PageTracker";
import RelatedGrid from "@/components/RelatedGrid";
import WatchlistButton from "@/components/WatchlistButton";
import ConditionPriceTabs from "@/components/ConditionPriceTabs";
import FigureRating from "@/components/FigureRating";
import AdminEditButton from "@/components/AdminEditButton";

interface ConditionPrice {
  condition: string;
  condition_label: string;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  sample_count: number;
}

interface FigureDetail {
  id: number;
  name: string;
  series?: string;
  manufacturer?: string;
  scale?: string;
  release_year?: number;
  image_url?: string;
  sculptor?: string;
  painter?: string;
  dimensions?: string;
  material?: string;
  gender?: string;
  figure_type?: string;
  age_rating?: string;
  release_date?: string;
  reissue_dates?: string;
  current_avg_price?: number;
  current_median_price?: number;
  price_change_pct?: number;
  price_trend_pct?: number;
  version_name?: string;
  original_name?: string;
  retail_price?: number;
  retail_currency?: string;
  character_name?: string;
  franchise_name?: string;
  condition_prices: ConditionPrice[];
  price_history: {
    date: string;
    avg_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
    sample_count: number;
  }[];
  price_history_by_condition?: Record<string, {
    date: string;
    avg_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
    sample_count: number;
  }[]>;
  related_figures: {
    id: number;
    name: string;
    image_url?: string;
    manufacturer?: string;
    retail_price?: number;
    current_median_price?: number;
    price_change_pct?: number;
  }[];
  rating_avg?: number | null;
  rating_count?: number;
  recent_listings: {
    id: number;
    source: string;
    title: string;
    price: number;
    currency: string;
    price_usd?: number;
    condition: string;
    is_sold: boolean;
    sold_at?: string;
    url?: string;
    image_url?: string;
  }[];
}

async function getFigure(id: string): Promise<FigureDetail | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/figures/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/figures/${id}`, { cache: "no-store" });
    if (!res.ok) return { title: "找不到此公仔" };
    const figure = await res.json();

    const priceInfo = figure.current_median_price
      ? `目前中位價 NT$${Math.round(figure.current_median_price * 32.2).toLocaleString()}`
      : figure.retail_price
        ? `定價 ¥${figure.retail_price.toLocaleString()}`
        : "";

    const description = `${figure.name}${figure.manufacturer ? ` (${figure.manufacturer})` : ""} 二手市場價格走勢、成交紀錄。${priceInfo}`;

    return {
      title: `${figure.name} — 二手行情`,
      description,
      alternates: {
        canonical: `https://figureout.tw/figures/${id}`,
      },
      openGraph: {
        title: `${figure.name} — 二手行情`,
        description,
        url: `https://figureout.tw/figures/${id}`,
        images: figure.image_url ? [{ url: figure.image_url, alt: figure.name }] : [],
        type: "website",
        siteName: "FigureOut",
      },
      twitter: {
        card: "summary_large_image",
        title: `${figure.name} — 二手行情`,
        description,
        images: figure.image_url ? [figure.image_url] : [],
      },
    };
  } catch {
    return { title: "PVC 公仔二級市場行情平台" };
  }
}

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  TWD: 32.2,
  JPY: 149.5,
  CNY: 7.25,
};

function formatPrice(priceUsd: number, currency: string = "TWD"): string {
  const rate = EXCHANGE_RATES[currency] || 1;
  const converted = priceUsd * rate;
  const symbols: Record<string, string> = {
    TWD: "NT$",
    JPY: "\u00a5",
    USD: "$",
    CNY: "\u00a5",
  };
  const symbol = symbols[currency] || currency + " ";
  if (currency === "JPY") {
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }
  return `${symbol}${converted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function Tag({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  if (!value) return null;
  return href ? (
    <a href={href} className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-xs transition-colors hover:border-[#C4A265]/50">
      <span className="text-[#6e7681]">{label}</span>
      <span className="text-[#C4A265]">{value}</span>
    </a>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-xs">
      <span className="text-[#6e7681]">{label}</span>
      <span className="text-[#c9d1d9]">{value}</span>
    </span>
  );
}

function InfoRow({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  const display = value || "未知";
  const isUnknown = !value;
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="w-16 shrink-0 text-xs text-[#6e7681]">{label}</span>
      {href && !isUnknown ? (
        <a href={href} className="min-w-0 break-words text-sm text-[#C4A265] hover:underline">{display}</a>
      ) : (
        <span className={`min-w-0 break-words text-sm ${isUnknown ? "text-[#484f58]" : "text-[#c9d1d9]"}`}>{display}</span>
      )}
    </div>
  );
}

function deduplicatePriceHistory(
  history: FigureDetail["price_history"]
): FigureDetail["price_history"] {
  if (!history || history.length === 0) return [];
  const byDate = new Map<string, (typeof history)[number]>();
  for (const entry of history) {
    byDate.set(entry.date, entry);
  }
  return Array.from(byDate.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

function buildJsonLd(figure: FigureDetail) {
  const product: Record<string, unknown> = {
    "@type": "Product",
    name: figure.name,
    image: figure.image_url || undefined,
    sku: figure.id.toString(),
    category: "PVC Figure",
    ...(figure.manufacturer ? { brand: { "@type": "Brand", name: figure.manufacturer } } : {}),
    ...(figure.original_name ? { alternateName: figure.original_name } : {}),
  };
  // Add aggregateRating if we have ratings
  if (figure.rating_avg && figure.rating_count && figure.rating_count > 0) {
    product.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: figure.rating_avg.toFixed(1),
      bestRating: "5",
      worstRating: "1",
      ratingCount: figure.rating_count,
    };
  }
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: figure.name + " - 二手行情",
    description: `${figure.name}${figure.manufacturer ? " (" + figure.manufacturer + ")" : ""} PVC 公仔二手市場行情追蹤`,
    url: `https://figureout.tw/figures/${figure.id}`,
    mainEntity: product,
  };
  return jsonLd;
}

export default async function FigureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ currency?: string }>;
}) {
  const { id } = await params;
  const { currency = "TWD" } = await searchParams;
  const figure = await getFigure(id);

  if (!figure) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-xl font-bold text-[#c9d1d9]">找不到此公仔</h1>
        <p className="mt-2 text-sm text-[#6e7681]">此公仔不存在或已被移除。</p>
      </div>
    );
  }

  const latestSnapshot =
    figure.price_history.length > 0
      ? figure.price_history[figure.price_history.length - 1]
      : null;

  const chartData = deduplicatePriceHistory(figure.price_history);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(figure)) }}
      />
      <PageTracker page={`/figures/${id}`} figureId={parseInt(id)} />

      {/* Breadcrumb */}
      {(figure.franchise_name || figure.character_name) && (
        <nav className="mb-4 flex flex-wrap items-center text-xs text-[#6e7681]">
          {figure.franchise_name && (
            <a href={`/search?q=${encodeURIComponent(figure.franchise_name)}`} className="text-[#C4A265] hover:underline">
              {figure.franchise_name}
            </a>
          )}
          {figure.franchise_name && figure.character_name && <span className="mx-1.5">&gt;</span>}
          {figure.character_name && (
            <a href={`/search?character=${encodeURIComponent(figure.character_name)}&q=${encodeURIComponent(figure.franchise_name || "")}`} className="text-[#C4A265] hover:underline">
              {figure.character_name}
            </a>
          )}
          <span className="mx-1.5">&gt;</span>
          <span className="text-[#8b949e]">{figure.name}</span>
        </nav>
      )}

      {/* 1. Hero: Image + Title + Tags + Price Summary + Condition Prices — flex row */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:gap-6">
        {/* Image */}
        <div className="shrink-0 sm:w-[300px]">
          {figure.image_url ? (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] sm:h-full">
              <img src={figure.image_url} alt={figure.name} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-[200px] w-full items-center justify-center rounded-lg border border-[#30363d] bg-[#161b22] text-sm text-[#484f58] sm:h-full">No Image</div>
          )}
        </div>

        {/* Title + Tags + Price Summary + Condition Prices */}
        <div className="flex-1 space-y-3">
          <div>
            <div className="flex items-start gap-2"><h1 className="flex-1 text-xl font-bold text-[#c9d1d9] sm:text-2xl">{figure.name}</h1><WatchlistButton figureId={figure.id} size="md" /><ErrorReportButton figureId={parseInt(id)} /><AdminEditButton figureId={figure.id} /></div>
            {figure.original_name && <p className="mt-0.5 text-sm text-[#6e7681]">{figure.original_name}</p>}
            <div className="mt-1.5">
              <FigureRating figureId={id} initialAvg={figure.rating_avg ?? null} initialCount={figure.rating_count ?? 0} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag label="製造商" value={figure.manufacturer} href={figure.manufacturer ? `/search?manufacturer=${encodeURIComponent(figure.manufacturer)}` : undefined} />
              <Tag label="比例" value={figure.scale} href={figure.scale ? `/search?scale=${encodeURIComponent(figure.scale)}` : undefined} />
              <Tag label="系列" value={figure.series} href={figure.series ? `/search?q=${encodeURIComponent(figure.series)}` : undefined} />
              <Tag label="版本" value={figure.version_name} href={figure.version_name ? `/search?q=${encodeURIComponent(figure.version_name)}` : undefined} />
              <Tag label="原型師" value={figure.sculptor} href={figure.sculptor ? `/search?sculptor=${encodeURIComponent(figure.sculptor)}` : undefined} />
              <Tag label="塗裝師" value={figure.painter} href={figure.painter ? `/search?painter=${encodeURIComponent(figure.painter)}` : undefined} />
            </div>
          </div>

          {/* Price Summary */}
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#6e7681]">價格摘要</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-[#6e7681]">平均</p>
                <p className="text-base font-bold text-[#C4A265] sm:text-xl">
                  {figure.current_avg_price != null ? formatPrice(figure.current_avg_price, currency) : "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6e7681]">中位數</p>
                <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">
                  {figure.current_median_price != null ? formatPrice(figure.current_median_price, currency) : "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6e7681]">最低</p>
                <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">
                  {latestSnapshot?.min_price != null ? formatPrice(latestSnapshot.min_price, currency) : "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6e7681]">最高</p>
                <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">
                  {latestSnapshot?.max_price != null ? formatPrice(latestSnapshot.max_price, currency) : "--"}
                </p>
              </div>
            </div>
            {figure.retail_price != null && (
              <p className="mt-3 text-xs text-[#6e7681]">
                定價 <span className="text-[#8b949e]">{formatPrice(figure.retail_price! * ({"JPY": 1/149.5, "CNY": 1/7.25}[figure.retail_currency || "JPY"] || 1/149.5), currency)} ({"\u00a5"}{figure.retail_price.toLocaleString()})</span>
              </p>
            )}
            {figure.price_change_pct != null && (
              <p className="mt-1 text-xs">
                <span className="text-[#6e7681]">vs 定價</span>{" "}
                <span className={figure.price_change_pct >= 0 ? "text-[#3fb950]" : "text-[#f85149]"}>
                  {figure.price_change_pct >= 0 ? "+" : ""}{figure.price_change_pct.toFixed(1)}%
                </span>
              </p>
            )}
          </div>

          {/* Condition Prices — tabbed view */}
          {figure.condition_prices.length > 0 && (
            <ConditionPriceTabs prices={figure.condition_prices} currency={currency} />
          )}
        </div>
      </div>

      {/* ReportForm — prominent, full width */}
      <section className="mb-6">
        <ReportForm figureId={id} />
      </section>


      {/* 3. Price Chart */}
      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-[#c9d1d9]">價格走勢</h2>
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 sm:p-4">
          <PriceChart data={chartData} listings={figure.recent_listings} dataByCondition={figure.price_history_by_condition ? Object.fromEntries(Object.entries(figure.price_history_by_condition).map(([k, v]) => [k, deduplicatePriceHistory(v)])) : undefined} currency={currency} />
        </div>
      </section>

      {/* 4. Recent Listings */}
      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-[#c9d1d9]">近期成交紀錄</h2>
        <ListingsTable listings={figure.recent_listings} currency={currency} figureId={parseInt(id)} />
      </section>

      {/* 5. Detail Info */}
      <section className="mb-6">
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6e7681]">商品資訊</h2>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <InfoRow label="製造商" value={figure.manufacturer} href={figure.manufacturer ? `/search?manufacturer=${encodeURIComponent(figure.manufacturer)}` : undefined} />
            <InfoRow label="比例" value={figure.scale} href={figure.scale ? `/search?scale=${encodeURIComponent(figure.scale)}` : undefined} />
            <InfoRow label="系列" value={figure.series} href={figure.series ? `/search?q=${encodeURIComponent(figure.series)}` : undefined} />
            <InfoRow label="版本" value={figure.version_name} />
            <InfoRow label="角色" value={figure.character_name} href={figure.character_name ? `/search?character=${encodeURIComponent(figure.character_name)}&q=${encodeURIComponent(figure.franchise_name || "")}` : undefined} />
            <InfoRow label="作品" value={figure.franchise_name} href={figure.franchise_name ? `/search?q=${encodeURIComponent(figure.franchise_name)}` : undefined} />
            <InfoRow label="原型師" value={figure.sculptor} href={figure.sculptor ? `/search?sculptor=${encodeURIComponent(figure.sculptor)}` : undefined} />
            <InfoRow label="塗裝師" value={figure.painter} href={figure.painter ? `/search?painter=${encodeURIComponent(figure.painter)}` : undefined} />
            <InfoRow label="素材" value={figure.material} />
            <InfoRow label="尺寸" value={figure.dimensions} />
            <InfoRow label="類型" value={figure.figure_type} />
            <InfoRow label="性別" value={figure.gender} />
            <InfoRow label="年齡分級" value={figure.age_rating} />
            <InfoRow label="發售年份" value={figure.release_year?.toString()} />
            <InfoRow label="發售日期" value={figure.release_date} />
            <InfoRow label="再版日期" value={figure.reissue_dates} />
          </div>
        </div>
      </section>

      {/* 6. Community Notes */}
      <section className="mb-6">
        <FigureNotes figureId={id} />
      </section>

      {/* 7. Trading Board */}
      <section className="mb-6">
        <TradingBoard figureId={id} />
      </section>

      {/* 8. Related Figures */}
      {(() => {
        const seen = new Set<number>();
        const unique = (figure.related_figures || []).filter((f) => {
          if (seen.has(f.id) || f.id === figure.id) return false;
          seen.add(f.id);
          return true;
        });
        return unique.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-3 text-base font-semibold text-[#c9d1d9]">相關商品</h2>
            <RelatedGrid figures={unique} currency={currency} />
          </section>
        ) : null;
      })()}
    </div>
  );
}
