"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PageTracker from "@/components/PageTracker";
import SearchBar from "@/components/SearchBar";
import SearchResultsGrid from "@/components/SearchResultsGrid";
import Pagination from "@/components/Pagination";

interface FigureOut {
  id: number;
  name: string;
  manufacturer?: string;
  scale?: string;
  image_url?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
  franchise_name?: string;
  character_name?: string;
}

const PAGE_SIZE = 36;

/**
 * Search results. This page briefly listed the entire catalogue when given no
 * query, which made the API the cheapest way to clone the price data — 337
 * requests for all 33k rows. The endpoint now requires a predicate and this
 * page asks for one instead of enumerating.
 */
export default function FiguresSearch() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const currency = searchParams.get("currency") || "TWD";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));

  const [figures, setFigures] = useState<FigureOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(!!q);

  useEffect(() => {
    if (!q) {
      setFigures([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const p = new URLSearchParams({
      q,
      limit: String(PAGE_SIZE),
      skip: String((page - 1) * PAGE_SIZE),
      currency,
      fields: "card",
    });
    fetch(`${apiUrl}/figures?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : { figures: [], total: 0 }))
      .then((d) => {
        setFigures(d.figures || []);
        setTotal(d.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, q, currency, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!q) {
    return (
      <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
        <PageTracker page="/figures" />
        <div className="pb-[clamp(20px,3.5vh,34px)]">
          <span className="lbl">搜尋</span>
          <h1 className="display">找一隻公仔</h1>
        </div>
        <SearchBar large />
        <p className="mt-8 text-[14px] text-[var(--ink-2)]">
          或改用{" "}
          <Link href="/browse" className="text-[var(--ink)] underline underline-offset-4">
            作品分類
          </Link>
          {" · "}
          <Link href="/trending" className="text-[var(--ink)] underline underline-offset-4">
            排行榜
          </Link>
          {" "}瀏覽。
        </p>
      </div>
    );
  }

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <PageTracker page={`/figures?q=${q}`} />

      <div className="pb-[clamp(18px,3vh,28px)]">
        <span className="lbl">搜尋</span>
        <h1 className="display">{q}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
          {loading ? "載入中" : `共 ${total.toLocaleString("en-US")} 件`}
        </p>
      </div>

      {!loading && figures.length === 0 ? (
        <div className="rule py-12 text-center">
          <p className="text-[16px] text-[var(--ink)]">找不到相關公仔</p>
          <Link
            href="/submit"
            className="mono-sm mt-5 inline-block text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            提交這隻公仔 ↗
          </Link>
        </div>
      ) : (
        <>
          <SearchResultsGrid figures={figures} currency={currency} />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPage={(p) => {
              const next = new URLSearchParams(searchParams.toString());
              next.set("page", String(p));
              router.push(`/figures?${next.toString()}`);
              window.scrollTo({ top: 0 });
            }}
          />
        </>
      )}
    </div>
  );
}
