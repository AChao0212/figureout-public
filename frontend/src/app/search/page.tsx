import type { Metadata } from "next";
import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import SearchResultsGrid from "@/components/SearchResultsGrid";
import Pagination from "@/components/Pagination";

export const metadata: Metadata = {
  title: "搜尋公仔",
  description: "搜尋 37,000+ 公仔二手市場價格",
  // All search URL variants share the same canonical (the base /search page)
  // This prevents Google "duplicate without canonical" warnings
  alternates: {
    canonical: "https://figureout.tw/search",
  },
  // Search result pages with filters shouldn't be indexed — infinite variations
  robots: { index: false, follow: false },
};

interface Figure {
  id: number;
  name: string;
  image_url?: string;
  manufacturer?: string;
  scale?: string;
  retail_price?: number;
  current_avg_price?: number;
  current_median_price?: number;
  price_change_pct?: number;
  version_name?: string;
  character_name?: string;
  franchise_name?: string;
}

const PAGE_SIZE = 24;

async function searchFigures(params: Record<string, string>): Promise<{ figures: Figure[]; total: number }> {
  // Server-side: prefer the internal URL so the request stays inside the compose
  // network instead of going back out through Cloudflare (which can ETIMEDOUT
  // from inside the container) — same rule the home page already follows.
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) searchParams.set(k, v);
    }
    // Grids render eight fields; the default shape carries thirty.
    searchParams.set("fields", "card");
    const res = await fetch(`${apiUrl}/figures?${searchParams.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return { figures: [], total: 0 };
    return await res.json();
  } catch {
    return { figures: [], total: 0 };
  }
}

function buildUrl(base: Record<string, string>, overrides: Record<string, string>): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v && k !== "currency") params.set(k, v);
  }
  return `/search?${params.toString()}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; currency?: string; scale?: string; manufacturer?: string;
    series?: string; franchise?: string;
    character?: string; sculptor?: string; painter?: string;
    illustrator?: string; figure_type?: string;
    sort?: string; page?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q || "";
  const currency = sp.currency || "TWD";
  const scale = sp.scale || "";
  const manufacturer = sp.manufacturer || "";
  const series = sp.series || "";
  const franchise = sp.franchise || "";
  const sculptor = sp.sculptor || "";
  const character = (sp as any).character || "";
  const painter = sp.painter || "";
  const illustrator = sp.illustrator || "";
  const figure_type = sp.figure_type || "";
  const sort = sp.sort || "";
  const page = Math.max(1, parseInt(sp.page || "1"));

  const hasQuery = q || scale || manufacturer || series || franchise || sculptor || painter || illustrator || figure_type || character;
  const skip = (page - 1) * PAGE_SIZE;

  const { figures, total } = hasQuery
    ? await searchFigures({ q, scale, manufacturer, series, franchise, sculptor, painter, illustrator, figure_type, character, sort, skip: String(skip), limit: String(PAGE_SIZE), currency })
    : { figures: [], total: 0 };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const baseParams: Record<string, string> = { q, scale, manufacturer, series, franchise, sculptor, painter, illustrator, figure_type, character, sort };

  const filterLabels: string[] = [];
  if (q) filterLabels.push(q);
  if (scale) filterLabels.push(`比例: ${scale}`);
  if (series) filterLabels.push(`系列: ${series}`);
  if (franchise) filterLabels.push(`作品: ${franchise}`);
  if (character) filterLabels.push(`角色: ${character}`);
  if (manufacturer) filterLabels.push(`製造商: ${manufacturer}`);
  if (sculptor) filterLabels.push(`原型師: ${sculptor}`);
  if (painter) filterLabels.push(`塗裝: ${painter}`);
  if (illustrator) filterLabels.push(`原畫: ${illustrator}`);
  if (figure_type) filterLabels.push(`類型: ${figure_type}`);

  const sortOptions = [
    { value: "", label: "預設" },
    { value: "price_asc", label: "價格低→高" },
    { value: "price_desc", label: "價格高→低" },
    { value: "release_desc", label: "最新發售" },
    { value: "name_asc", label: "名稱 A→Z" },
  ];

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <SearchBar defaultValue={q} />

      {hasQuery && (
        <div className="flex flex-col gap-4 pt-[clamp(22px,3.5vh,34px)]">
          {/* label above value — the row never mixes two text colours */}
          <div>
            <span className="lbl">搜尋條件 · {total.toLocaleString("en-US")} 筆</span>
            <p className="text-[15px] text-[var(--ink)]">{filterLabels.join(" · ")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="mono-sm text-[var(--muted)]">排序</span>
            {sortOptions.map((opt) => (
              <Link
                key={opt.value}
                href={buildUrl(baseParams, { sort: opt.value, page: "1" })}
                className={`mono-sm transition-colors ${
                  sort === opt.value
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {figures.length === 0 && hasQuery ? (
        <div className="rule mt-[clamp(22px,3.5vh,34px)] py-12 text-center">
          <p className="text-[16px] text-[var(--ink)]">找不到相關公仔</p>
          <p className="mt-2 text-[14px] text-[var(--ink-2)]">
            試試其他關鍵字，或確認拼字是否正確。
          </p>
          <Link
            href="/submit"
            className="mono-sm mt-5 inline-block text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            提交這隻公仔 ↗
          </Link>
        </div>
      ) : (
        <div className="pt-[clamp(20px,3vh,30px)]">
          <SearchResultsGrid figures={figures} currency={currency} />

          <Pagination page={page} totalPages={totalPages} basePath="/search" params={baseParams} />

          {figures.length > 0 && (
            <p className="mt-6 text-center">
              <Link
                href="/submit"
                className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              >
                找不到想要的公仔?提交新公仔 ↗
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
