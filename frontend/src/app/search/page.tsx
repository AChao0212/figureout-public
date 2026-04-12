import type { Metadata } from "next";
import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import SearchResultsGrid from "@/components/SearchResultsGrid";

export const metadata: Metadata = {
  title: "搜尋公仔",
  description: "搜尋 37,000+ 公仔二手市場價格",
  // All search URL variants share the same canonical (the base /search page)
  // This prevents Google "duplicate without canonical" warnings
  alternates: {
    canonical: "https://figureout.tw/search",
  },
  // Search result pages with filters shouldn't be indexed — infinite variations
  robots: { index: false, follow: true },
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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) searchParams.set(k, v);
    }
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
    q?: string; currency?: string; scale?: string; manufacturer?: string; character?: string;
    sculptor?: string; painter?: string; figure_type?: string;
    sort?: string; page?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q || "";
  const currency = sp.currency || "TWD";
  const scale = sp.scale || "";
  const manufacturer = sp.manufacturer || "";
  const sculptor = sp.sculptor || "";
  const character = (sp as any).character || "";
  const painter = sp.painter || "";
  const figure_type = sp.figure_type || "";
  const sort = sp.sort || "";
  const page = Math.max(1, parseInt(sp.page || "1"));

  const hasQuery = q || scale || manufacturer || sculptor || painter || figure_type || character;
  const skip = (page - 1) * PAGE_SIZE;

  const { figures, total } = hasQuery
    ? await searchFigures({ q, scale, manufacturer, sculptor, painter, figure_type, character, sort, skip: String(skip), limit: String(PAGE_SIZE) })
    : { figures: [], total: 0 };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const baseParams: Record<string, string> = { q, scale, manufacturer, sculptor, painter, figure_type, character, sort };

  const filterLabels: string[] = [];
  if (q) filterLabels.push(q);
  if (scale) filterLabels.push(`比例: ${scale}`);
  if (manufacturer) filterLabels.push(`製造商: ${manufacturer}`);
  if (sculptor) filterLabels.push(`原型師: ${sculptor}`);
  if (painter) filterLabels.push(`塗裝: ${painter}`);
  if (figure_type) filterLabels.push(`類型: ${figure_type}`);

  const sortOptions = [
    { value: "", label: "預設" },
    { value: "price_asc", label: "價格低→高" },
    { value: "price_desc", label: "價格高→低" },
    { value: "release_desc", label: "最新發售" },
    { value: "name_asc", label: "名稱 A→Z" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 max-w-lg">
        <SearchBar defaultValue={q} />
      </div>

      {hasQuery && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#8b949e]">
              搜尋結果：{" "}
              <span className="font-medium text-[#c9d1d9]">{filterLabels.join(" · ")}</span>
              <span className="ml-2 text-[#6e7681]">({total} 筆)</span>
            </p>
          </div>
          {/* Sort - scrollable on mobile */}
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-[#6e7681]">排序</span>
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
              {sortOptions.map((opt) => (
                <Link
                  key={opt.value}
                  href={buildUrl(baseParams, { sort: opt.value, page: "1" })}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                    sort === opt.value
                      ? "border-[#C4A265] bg-[#C4A265]/20 text-[#C4A265]"
                      : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {figures.length === 0 && hasQuery ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-10 text-center">
          <p className="text-base text-[#8b949e]">找不到相關公仔</p>
          <p className="mt-1 text-sm text-[#6e7681]">試試其他關鍵字，或確認拼字是否正確。</p>
          <Link href="/submit" className="mt-3 inline-block text-sm text-[#C4A265] hover:underline">
            找不到你的公仔？點此提交
          </Link>
        </div>
      ) : (
        <div>
          <SearchResultsGrid figures={figures} currency={currency} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
              {page > 1 && (
                <Link
                  href={buildUrl(baseParams, { page: String(page - 1) })}
                  className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
                >
                  上一頁
                </Link>
              )}
              {(() => {
                const pages: (number | string)[] = [];
                if (totalPages <= 5) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push("...");
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push("...");
                  pages.push(totalPages);
                }
                return pages.map((p, idx) =>
                  typeof p === "string" ? (
                    <span key={`ellipsis-${idx}`} className="px-1.5 py-2 text-xs text-[#6e7681]">...</span>
                  ) : (
                    <Link
                      key={p}
                      href={buildUrl(baseParams, { page: String(p) })}
                      className={`rounded-lg border px-2.5 py-2 text-xs transition-colors sm:px-3 ${
                        p === page
                          ? "border-[#C4A265] bg-[#C4A265]/20 text-[#C4A265]"
                          : "border-[#30363d] bg-[#161b22] text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
                      }`}
                    >
                      {p}
                    </Link>
                  )
                );
              })()}
              {page < totalPages && (
                <Link
                  href={buildUrl(baseParams, { page: String(page + 1) })}
                  className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
                >
                  下一頁
                </Link>
              )}
            </div>
          )}

          {figures.length > 0 && (
            <p className="mt-4 text-center text-xs text-[#6e7681]">
              <Link href="/submit" className="text-[#C4A265] hover:underline">
                找不到想要的公仔？提交新公仔
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
