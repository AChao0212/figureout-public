"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";

interface Listing {
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
  notes?: string;
}

interface ListingsTableProps {
  listings: Listing[];
  currency?: string;
  figureId?: number;
}

const EXCHANGE_RATES: Record<string, number> = { USD: 1, TWD: 32.2, JPY: 149.5, CNY: 7.25 };

function convertToDisplay(listing: Listing, displayCurrency: string): string {
  const sym: Record<string, string> = { TWD: "NT$", JPY: "\u00a5", USD: "$", CNY: "\u00a5" };
  const symbol = sym[displayCurrency] || "$";

  let usd = listing.price_usd;
  if (!usd) {
    const fromRate = EXCHANGE_RATES[listing.currency] || 1;
    usd = listing.price / fromRate;
  }
  const converted = usd * (EXCHANGE_RATES[displayCurrency] || 1);

  if (displayCurrency === "JPY") return `${symbol}${Math.round(converted).toLocaleString()}`;
  return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const SOURCE_LABELS: Record<string, string> = {
  mercari: "Mercari",
  mercari_jp: "Mercari",
  yahoo_auction: "Yahoo",
  yahoo_jp: "Yahoo",
  user_report: "社群回報",
  manual: "手動",
};

const CONDITION_LABELS: Record<string, string> = {
  sealed: "全新",
  opened: "拆檢",
  used: "拆擺",
  damaged: "瑕疵",
};

function formatDate(listing: Listing): string {
  if (listing.sold_at) {
    try {
      return format(parseISO(listing.sold_at), "yyyy/MM/dd");
    } catch {
      return "--";
    }
  }
  return "--";
}

function ReportButton({ listingId, figureId }: { listingId: number; figureId?: number }) {
  const [reported, setReported] = useState(false);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const reportOptions = [
    { type: "wrong_price", label: "價格偏離" },
    { type: "wrong_item", label: "商品錯誤" },
    { type: "duplicate", label: "重複紀錄" },
  ];

  const handleReport = async (reportType: string, label: string) => {
    if (reported) return;
    setShowModal(false);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    try {
      const res = await fetch(`${apiUrl}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figure_id: figureId,
          report_type: reportType,
          description: `Listing #${listingId} ${label}`,
        }),
      });
      if (res.ok) {
        setReported(true);
      } else {
        setError(true);
        setTimeout(() => setError(false), 3000);
      }
    } catch {
      setError(true);
      setTimeout(() => setError(false), 3000);
    }
  };

  if (reported) {
    return <span className="whitespace-nowrap text-[10px] text-[#3fb950]">&#10003; 已回報</span>;
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] transition-colors ${
          error ? "text-[#f85149]" : "text-[#6e7681] hover:bg-[#f85149]/10 hover:text-[#f85149]"
        }`}
        title="回報問題"
      >
        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span>{error ? "失敗" : "回報"}</span>
      </button>
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="mx-4 w-full max-w-[240px] rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="mb-3 text-center text-xs font-semibold text-[#c9d1d9]">回報類型</p>
            <div className="space-y-2">
              {reportOptions.map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => handleReport(opt.type, opt.label)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs text-[#c9d1d9] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowModal(false)} className="mt-3 w-full text-center text-[10px] text-[#6e7681] hover:text-[#8b949e]">取消</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function ListingsTable({ listings, currency = "TWD", figureId }: ListingsTableProps) {
  if (!listings || listings.length === 0) {
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-6 text-center text-sm text-[#6e7681]">
        暫無成交紀錄
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden rounded-lg border border-[#30363d] sm:block">
        <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[68px]" />
              <col />
              <col className="w-[88px]" />
              <col className="w-[78px]" />
              <col className="w-[90px]" />
              <col className="w-[52px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#161b22] text-xs text-[#8b949e]">
              <tr>
                <th className="px-3 py-2">來源</th>
                <th className="px-3 py-2">商品名稱</th>
                <th className="px-3 py-2">價格</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">日期</th>
                <th className="px-1 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262d]">
              {listings.map((listing) => (
                <tr key={listing.id} className="bg-[#0d1117] transition-colors hover:bg-[#161b22]">
                  <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-[#C4A265]">
                    {SOURCE_LABELS[listing.source] || listing.source}
                  </td>
                  <td className="truncate px-3 py-2 text-[#c9d1d9]">
                    {listing.url ? (
                      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#C4A265] hover:underline">
                        {listing.title}
                      </a>
                    ) : listing.title}
                    {listing.notes && <p className="mt-0.5 truncate text-[10px] text-[#6e7681]">{listing.notes}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-[#e6edf3]">
                    {convertToDisplay(listing, currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      listing.condition === "sealed" || listing.condition === "new"
                        ? "bg-[#3fb950]/10 text-[#3fb950]"
                        : "bg-[#8b949e]/10 text-[#8b949e]"
                    }`}>
                      {CONDITION_LABELS[listing.condition] || listing.condition}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#8b949e]">
                    {formatDate(listing)}
                  </td>
                  <td className="px-1 py-2">
                    <ReportButton listingId={listing.id} figureId={figureId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {listings.length > 5 && (
          <div className="border-t border-[#21262d] bg-[#0d1117] px-3 py-1.5 text-center text-[10px] text-[#484f58]">
            共 {listings.length} 筆，向下捲動查看更多
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="max-h-[350px] space-y-2 overflow-y-auto scrollbar-thin sm:hidden">
        {listings.map((listing) => (
          <div key={listing.id} className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-xs text-[#c9d1d9]">
                {listing.url ? (
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#C4A265]">
                    {listing.title}
                  </a>
                ) : listing.title}
              </p>
              {listing.notes && <p className="mt-0.5 truncate text-[10px] text-[#6e7681]">{listing.notes}</p>}
              <div className="flex shrink-0 items-center gap-2">
                <p className="font-mono text-sm font-semibold text-[#e6edf3]">
                  {convertToDisplay(listing, currency)}
                </p>
                <ReportButton listingId={listing.id} figureId={figureId} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#6e7681]">
              <span className="font-medium text-[#C4A265]">{SOURCE_LABELS[listing.source] || listing.source}</span>
              {listing.condition && (
                <>
                  <span>&middot;</span>
                  <span className={listing.condition === "sealed" ? "text-[#3fb950]" : "text-[#8b949e]"}>
                    {CONDITION_LABELS[listing.condition] || listing.condition}
                  </span>
                </>
              )}
              <span>&middot;</span>
              <span>{formatDate(listing)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
