import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
import ImageWithFallback from "@/components/ImageWithFallback";
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
  illustrator?: string;
  dimensions?: string;
  material?: string;
  official_url?: string;
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
  retail_price_display?: number;
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
    price_canonical?: number;
    condition: string;
    is_sold: boolean;
    sold_at?: string;
    url?: string;
    image_url?: string;
  }[];
}

async function getFigure(id: string, currency: string = "TWD"): Promise<FigureDetail | null> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/figures/${id}?currency=${encodeURIComponent(currency)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/figures/${id}`, { cache: "no-store" });
    if (!res.ok) {
      return {
        title: "找不到此公仔",
        robots: { index: false, follow: false },
      };
    }
    const figure = await res.json();

    // Every figure page has unique structured product data (name, manufacturer,
    // character, franchise, scale, image, JSON-LD Product schema) — that's
    // enough for Google to treat it as a valid catalog entry even before any
    // listings come in. Previously we noindexed figures without listing data,
    // but that was over-cautious: it locked ~9K legit product pages out of
    // search and removed long-tail discovery (someone googling a figure name
    // could no longer land on us). Index all real figures; only noindex on
    // outright fetch failures (handled above with `!res.ok`).

    const priceInfo = figure.current_median_price
      ? `目前中位價 NT$${Math.round(figure.current_median_price * 32.2).toLocaleString()}`
      : figure.retail_price
        ? `定價 ¥${figure.retail_price.toLocaleString()}`
        : "";

    const description = `${figure.name}${figure.manufacturer ? ` (${figure.manufacturer})` : ""} 二手市場價格走勢、成交紀錄。${priceInfo}`;

    return {
      title: `${figure.name} — 二手行情`,
      description,
      robots: { index: true, follow: true },
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

// Backend already converts prices to display currency (via /figures/{id}?currency=XXX),
// so `formatPrice` is just an alias to the shared `formatCurrency` helper.
const formatPrice = formatCurrency;

// Multi-value fields (sculptor/painter/series) may hold several values joined
// by the Chinese enumeration comma 「、」. When a `searchKey` is supplied we
// split on it and render each part as its own search link, so e.g.
// "Yoshi、そんそーす" becomes two clickable sculptors.
const MULTI_SPLIT = /\s*、\s*/;

// Build a search URL: ?{searchKey}={value}&{extraK}={extraV}... — extraParams
// lets the character link keep its franchise scope after a 、 split, so
// "貞德、莫德雷德" each get linked WITH the figure's franchise context.
function _searchHref(searchKey: string, value: string, extraParams?: Record<string, string | undefined>): string {
  const qs = [`${searchKey}=${encodeURIComponent(value)}`];
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) qs.push(`${k}=${encodeURIComponent(v)}`);
    }
  }
  return `/search?${qs.join("&")}`;
}

function Tag({ label, value, href, searchKey, extraParams }: { label: string; value?: string | null; href?: string; searchKey?: string; extraParams?: Record<string, string | undefined> }) {
  if (!value || HIDDEN_PLACEHOLDERS.has(value.trim())) return null;
  const chip = "inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-xs transition-colors hover:border-[#C4A265]/50";
  if (searchKey && value.includes("、")) {
    const parts = value.split(MULTI_SPLIT).filter(Boolean);
    return (
      <>
        {parts.map((p, i) => (
          <a key={i} href={_searchHref(searchKey, p, extraParams)} className={chip}>
            {i === 0 && <span className="text-[#6e7681]">{label}</span>}
            <span className="text-[#C4A265]">{p}</span>
          </a>
        ))}
      </>
    );
  }
  const finalHref = searchKey ? _searchHref(searchKey, value, extraParams) : href;
  return finalHref ? (
    <a href={finalHref} className={chip}>
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

// Globally-meaningless placeholder values that imported/auto-generated rows use
// for "no real data". Hide these so a normal user doesn't see a wall of
// "角色: 其他" / "作品: 待分類" / "尺寸: 未知" rows. (Editor view is via /admin,
// which has its own form-based UI.)
const HIDDEN_PLACEHOLDERS = new Set(["未知", "未分類", "待分類", "其他", "其它"]);

function InfoRow({ label, value, href, searchKey, extraParams }: { label: string; value?: string | null; href?: string; searchKey?: string; extraParams?: Record<string, string | undefined> }) {
  // Don't render the row at all if there's nothing meaningful to show.
  if (!value || HIDDEN_PLACEHOLDERS.has(value.trim())) return null;
  const display = value;
  const isUnknown = false;
  if (searchKey && value && value.includes("、")) {
    const parts = value.split(MULTI_SPLIT).filter(Boolean);
    return (
      <div className="flex items-start gap-2 py-1">
        <span className="w-16 shrink-0 text-xs text-[#6e7681]">{label}</span>
        <span className="min-w-0 break-words text-sm">
          {parts.map((p, i) => (
            <span key={i}>
              <a href={_searchHref(searchKey, p, extraParams)} className="text-[#C4A265] hover:underline">{p}</a>
              {i < parts.length - 1 && <span className="text-[#6e7681]">、</span>}
            </span>
          ))}
        </span>
      </div>
    );
  }
  const finalHref = searchKey && value ? _searchHref(searchKey, value, extraParams) : href;
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="w-16 shrink-0 text-xs text-[#6e7681]">{label}</span>
      {finalHref && !isUnknown ? (
        <a href={finalHref} className="min-w-0 break-words text-sm text-[#C4A265] hover:underline">{display}</a>
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

// Safely serialize an object for embedding in <script type="application/ld+json">.
// JSON.stringify does NOT escape </script>, <, >, or &, so we must do it manually
// to prevent XSS via user-controlled figure names / descriptions.
function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildJsonLd(figure: FigureDetail) {
  const hasPrice = figure.current_avg_price != null || figure.current_median_price != null;

  // Always use Product — even without pricing data, it's still a sellable
  // physical product. The previous "Thing" fallback was invalid Schema.org:
  // Thing doesn't accept `brand` or `aggregateRating`, so GSC was flagging
  // these as "「<parent_node>」欄位的物件類型無效". Product with optional
  // offers/aggregateRating is valid in both cases.
  const mainEntity: Record<string, unknown> = {
    "@type": "Product",
    name: figure.name,
    image: figure.image_url || undefined,
    sku: figure.id.toString(),
    category: "PVC Figure",
    ...(figure.manufacturer ? { brand: { "@type": "Brand", name: figure.manufacturer } } : {}),
    ...(figure.original_name ? { alternateName: figure.original_name } : {}),
    // Map official_url onto Schema.org's Product.url (canonical official source).
    ...(figure.official_url ? { url: figure.official_url } : {}),
    // Illustrator(s) — surface as Product.creator (Person[]). Split on 「、」
    // to surface multi-illustrator credits as distinct entities for SEO.
    ...(figure.illustrator
      ? {
          creator: figure.illustrator
            .split(/[、,]/)
            .map((n) => n.trim())
            .filter(Boolean)
            .map((name) => ({ "@type": "Person", name })),
        }
      : {}),
  };

  // Add AggregateOffer for figures with price data (required for valid Product schema).
  // SEO crawlers want fixed-currency numbers; we use the lib's fallback rate (no live
  // rate available in this server render path).
  if (hasPrice && figure.recent_listings && figure.recent_listings.length > 0) {
    const prices = figure.recent_listings
      .filter((l) => l.price_canonical && l.price_canonical > 0)
      // price_canonical is already TWD — no conversion needed for the JSON-LD AggregateOffer.
      .map((l) => Math.round(l.price_canonical ?? 0));
    if (prices.length > 0) {
      mainEntity.offers = {
        "@type": "AggregateOffer",
        priceCurrency: "TWD",
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: prices.length,
        availability: "https://schema.org/LimitedAvailability",
      };
    }
  }

  // Add aggregateRating if we have ratings
  if (figure.rating_avg && figure.rating_count && figure.rating_count > 0) {
    mainEntity.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: figure.rating_avg.toFixed(1),
      bestRating: "5",
      worstRating: "1",
      ratingCount: figure.rating_count,
    };
  }

  // BreadcrumbList for navigation structure
  const breadcrumbItems: Record<string, unknown>[] = [
    { "@type": "ListItem", position: 1, name: "FigureOut", item: "https://figureout.tw" },
  ];
  if (figure.franchise_name) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: figure.franchise_name,
      item: `https://figureout.tw/browse`,
    });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    position: breadcrumbItems.length + 1,
    name: figure.name,
    item: `https://figureout.tw/figures/${figure.id}`,
  });

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: figure.name + " - 二手行情",
        description: `${figure.name}${figure.manufacturer ? " (" + figure.manufacturer + ")" : ""} PVC 公仔二手市場行情追蹤`,
        url: `https://figureout.tw/figures/${figure.id}`,
        mainEntity,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems,
      },
    ],
  };
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
  // Backend converts all aggregates (avg/median/price_history/condition_prices) to this currency
  // using live rates. Frontend only formats with the right symbol.
  const figure = await getFigure(id, currency);

  if (!figure) {
    notFound();
  }

  // Overall min/max across every snapshot day. The previous "latest snapshot only"
  // semantics gave nonsense for single-listing days (min == max == that one price).
  const overallMin =
    figure.price_history.length > 0
      ? Math.min(...figure.price_history.map(p => p.min_price).filter(v => v != null))
      : null;
  const overallMax =
    figure.price_history.length > 0
      ? Math.max(...figure.price_history.map(p => p.max_price).filter(v => v != null))
      : null;

  const chartData = deduplicatePriceHistory(figure.price_history);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(buildJsonLd(figure)) }}
      />
      <PageTracker page={`/figures/${id}`} figureId={parseInt(id)} />

      {/* Breadcrumb */}
      {(figure.franchise_name || figure.character_name) && (
        <nav className="mb-4 flex flex-wrap items-center text-xs text-[#6e7681]">
          {figure.franchise_name && (() => {
            const parts = figure.franchise_name.includes("、")
              ? figure.franchise_name.split(/\s*、\s*/).filter(Boolean)
              : [figure.franchise_name];
            return (
              <>
                {parts.map((p, i) => (
                  <span key={i}>
                    <a href={`/search?franchise=${encodeURIComponent(p)}`} className="text-[#C4A265] hover:underline">{p}</a>
                    {i < parts.length - 1 && <span className="text-[#6e7681]">、</span>}
                  </span>
                ))}
              </>
            );
          })()}
          {figure.franchise_name && figure.character_name && <span className="mx-1.5">&gt;</span>}
          {figure.character_name && (() => {
            const fr = figure.franchise_name ? `&franchise=${encodeURIComponent(figure.franchise_name)}` : "";
            const parts = figure.character_name.includes("、")
              ? figure.character_name.split(/\s*、\s*/).filter(Boolean)
              : [figure.character_name];
            return (
              <>
                {parts.map((p, i) => (
                  <span key={i}>
                    <a
                      href={`/search?character=${encodeURIComponent(p)}${fr}`}
                      className="text-[#C4A265] hover:underline"
                    >{p}</a>
                    {i < parts.length - 1 && <span className="text-[#6e7681]">、</span>}
                  </span>
                ))}
              </>
            );
          })()}
          <span className="mx-1.5">&gt;</span>
          <span className="text-[#8b949e]">{figure.name}</span>
        </nav>
      )}

      {/* 1. Hero: Image + Title + Tags + Price Summary + Condition Prices — flex row */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:gap-6">
        {/* Image */}
        <div className="shrink-0 sm:w-[300px]">
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] sm:h-full">
            <ImageWithFallback
              src={figure.image_url}
              alt={figure.name}
              className="h-full w-full min-h-[200px] object-contain"
            />
          </div>
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
              <Tag label="製造商" value={figure.manufacturer} searchKey="manufacturer" />
              <Tag label="比例" value={figure.scale} href={figure.scale ? `/search?scale=${encodeURIComponent(figure.scale)}` : undefined} />
              <Tag label="系列" value={figure.series} searchKey="series" />
              <Tag label="版本" value={figure.version_name} href={figure.version_name ? `/search?q=${encodeURIComponent(figure.version_name)}` : undefined} />
              <Tag label="原型師" value={figure.sculptor} searchKey="sculptor" />
              <Tag label="塗裝師" value={figure.painter} searchKey="painter" />
              <Tag label="原畫" value={figure.illustrator} searchKey="illustrator" />
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
                  {overallMin != null ? formatPrice(overallMin, currency) : "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6e7681]">最高</p>
                <p className="text-base font-bold text-[#c9d1d9] sm:text-xl">
                  {overallMax != null ? formatPrice(overallMax, currency) : "--"}
                </p>
              </div>
            </div>
            {figure.retail_price != null && (
              <p className="mt-3 text-xs text-[#6e7681]">
                定價 <span className="text-[#8b949e]">{figure.retail_price_display != null ? formatPrice(figure.retail_price_display, currency) : "--"} ({"\u00a5"}{figure.retail_price.toLocaleString()})</span>
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
            <InfoRow label="製造商" value={figure.manufacturer} searchKey="manufacturer" />
            <InfoRow label="比例" value={figure.scale} href={figure.scale ? `/search?scale=${encodeURIComponent(figure.scale)}` : undefined} />
            <InfoRow label="系列" value={figure.series} searchKey="series" />
            <InfoRow label="版本" value={figure.version_name} />
            <InfoRow
              label="角色"
              value={figure.character_name}
              searchKey="character"
              extraParams={figure.franchise_name ? { franchise: figure.franchise_name } : undefined}
            />
            <InfoRow label="作品" value={figure.franchise_name} searchKey="franchise" />
            <InfoRow label="原型師" value={figure.sculptor} searchKey="sculptor" />
            <InfoRow label="塗裝師" value={figure.painter} searchKey="painter" />
            <InfoRow label="原畫" value={figure.illustrator} searchKey="illustrator" />
            <InfoRow label="素材" value={figure.material} />
            <InfoRow label="尺寸" value={figure.dimensions} />
            <InfoRow label="類型" value={figure.figure_type} />
            <InfoRow label="性別" value={figure.gender} />
            <InfoRow label="年齡分級" value={figure.age_rating} />
            <InfoRow label="發售年份" value={figure.release_year?.toString()} />
            <InfoRow label="發售日期" value={figure.release_date} />
            <InfoRow label="再版日期" value={figure.reissue_dates} />
            {figure.official_url && (
              <div className="flex items-start gap-2 py-1">
                <span className="w-16 shrink-0 text-xs text-[#6e7681]">官方頁面</span>
                <a
                  href={figure.official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-words text-sm text-[#C4A265] hover:underline"
                >
                  前往 ↗
                </a>
              </div>
            )}
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
