"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/currency";

interface Listing {
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
  notes?: string;
}

interface ListingsTableProps {
  listings: Listing[];
  currency?: string;
  figureId?: number;
}

/** Show each listing in its ORIGINAL currency (no conversion). Mixed-currency tables
 * make the source data more legible — a JPY Yahoo auction reads as ¥XX,XXX, a TWD
 * social report reads as NT$X,XXX. Aggregates above the table already handle conversion. */
function listingPrice(listing: Listing): string {
  return formatCurrency(listing.price, listing.currency);
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
    return (
      <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[var(--hue-green)]">
        已回報
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={`whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
          error ? "text-[var(--hue-red)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
        title="回報問題"
      >
        {error ? "失敗" : "回報"}
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-[280px] border border-[var(--rule)] bg-[var(--ground)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="lbl">回報類型</span>
            <div className="mt-2 flex flex-col">
              {reportOptions.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => handleReport(opt.type, opt.label)}
                  className="border-b border-[var(--rule-faint)] py-3 text-left text-[14px] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Condition({ value }: { value: string }) {
  const label = CONDITION_LABELS[value] || value;
  const fresh = value === "sealed" || value === "new";
  return (
    <span style={fresh ? { color: "var(--hue-green)" } : undefined}>{label}</span>
  );
}

export default function ListingsTable({ listings, figureId }: ListingsTableProps) {
  if (!listings || listings.length === 0) {
    return (
      <p className="rule py-10 text-center text-[14px] text-[var(--ink-2)]">暫無成交紀錄</p>
    );
  }

  return (
    <>
      {/* Desktop — the shared hairline table, scrolling within its own box */}
      <div className="hidden sm:block">
        <div className="tbl-scroll max-h-[320px] overflow-y-auto">
          <table className="data">
            <thead>
              <tr>
                <th>來源</th>
                <th>商品名稱</th>
                <th>狀態</th>
                <th>日期</th>
                <th>價格</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id}>
                  <td className="k">{SOURCE_LABELS[listing.source] || listing.source}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 320 }}>
                    {listing.url ? (
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-sans text-[13px] text-[var(--ink)] underline-offset-2 hover:underline"
                      >
                        {listing.title}
                      </a>
                    ) : (
                      <span className="font-sans text-[13px] text-[var(--ink)]">{listing.title}</span>
                    )}
                    {listing.notes && (
                      <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{listing.notes}</span>
                    )}
                  </td>
                  <td>
                    <Condition value={listing.condition} />
                  </td>
                  <td>{formatDate(listing)}</td>
                  <td className="k">{listingPrice(listing)}</td>
                  <td>
                    <ReportButton listingId={listing.id} figureId={figureId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {listings.length > 8 && (
          <p className="pt-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            共 {listings.length} 筆 · 向下捲動
          </p>
        )}
      </div>

      {/* Mobile — hairline rows, no cards */}
      <div className="max-h-[380px] overflow-y-auto border-t border-[var(--rule)] sm:hidden">
        {listings.map((listing) => (
          <div key={listing.id} className="border-b border-[var(--rule-faint)] py-3.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ink)]">
                {listing.url ? (
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    {listing.title}
                  </a>
                ) : (
                  listing.title
                )}
              </p>
              <span className="num shrink-0 text-[14px] text-[var(--ink)]">{listingPrice(listing)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              <span className="text-[var(--ink-2)]">{SOURCE_LABELS[listing.source] || listing.source}</span>
              <span>·</span>
              <Condition value={listing.condition} />
              <span>·</span>
              <span>{formatDate(listing)}</span>
              <span className="ml-auto">
                <ReportButton listingId={listing.id} figureId={figureId} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
