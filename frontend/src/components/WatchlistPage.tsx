"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "./WatchlistContext";
import { usePurchases, type Purchase } from "./PurchaseContext";
import { useAuth } from "./AuthContext";
import { useExchangeRates, convertCurrency } from "./ExchangeRateContext";
import FigureCard from "./FigureCard";
import MarkAsPurchasedModal from "./MarkAsPurchasedModal";
import ReportForm from "./ReportForm";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FigureData {
  id: number;
  name: string;
  image_url?: string;
  manufacturer?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
}

const CONDITION_LABELS: Record<string, string> = {
  sealed: "全新", opened: "拆檢", used: "拆擺", damaged: "瑕疵",
};

export default function WatchlistPage() {
  const { watchlist, removeFromWatchlist, clearWatchlist } = useWatchlist();
  const { purchases, refresh: refreshPurchases } = usePurchases();
  const { user, token, refreshUser } = useAuth();
  const rates = useExchangeRates();
  const [figures, setFigures] = useState<FigureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"watchlist" | "purchases">("watchlist");
  const [markFigure, setMarkFigure] = useState<{ id: number; name: string } | null>(null);

  const currency = typeof window !== "undefined"
    ? localStorage.getItem("figureout_currency") || "TWD"
    : "TWD";

  useEffect(() => {
    if (watchlist.length === 0) {
      setFigures([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled(
      watchlist.map((id) =>
        fetch(`${API_BASE}/figures/${id}`).then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json() as Promise<FigureData>;
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setFigures(results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<FigureData>).value));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [watchlist]);

  const handleMarkPurchased = (figureId: number, figureName: string) => {
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setMarkFigure({ id: figureId, name: figureName });
  };

  const handleDeletePurchase = async (purchaseId: number) => {
    if (!token || !confirm("確定要從已購入清單移除？")) return;
    await fetch(`${API_BASE}/user/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshPurchases();
  };

  // Calculate total spent (TWD equivalent) using live exchange rates
  const totalTwd = purchases.reduce((sum, p) => {
    if (!p.price || !p.currency) return sum;
    return sum + convertCurrency(p.price, p.currency, "TWD", rates);
  }, 0);
  const purchasesWithPrice = purchases.filter((p) => p.price).length;

  const tabs = [
    { key: "watchlist" as const, label: "收藏", count: watchlist.length },
    { key: "purchases" as const, label: "已購入", count: purchases.length },
  ];

  if (!loading && watchlist.length === 0 && purchases.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <h2 className="text-xl font-semibold text-[#e6edf3]">你的清單是空的</h2>
        <p className="mt-2 text-sm text-[#8b949e]">瀏覽公仔並按下愛心即可加入收藏</p>
        <a href="/" className="mt-6 inline-block rounded-lg bg-[#C4A265] px-6 py-2.5 text-sm font-semibold text-[#0d1117] transition-colors hover:bg-[#B89255]">
          回到首頁
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-[#e6edf3] sm:text-2xl">我的清單</h1>
        {tab === "purchases" && purchasesWithPrice > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-[#6e7681]">總購入金額</p>
            <p className="text-lg font-bold text-[#C4A265]">NT${Math.round(totalTwd).toLocaleString()}</p>
          </div>
        )}
        {tab === "watchlist" && watchlist.length > 0 && (
          <button
            type="button"
            onClick={clearWatchlist}
            className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#f85149] transition-colors hover:border-[#f85149]/50"
          >
            清空收藏
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-[#161b22] text-[#C4A265]" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-[#6e7681]">{t.count}</span>
          </button>
        ))}
      </div>

      {loading && tab === "watchlist" && (
        <div className="py-12 text-center text-sm text-[#8b949e]">載入中...</div>
      )}

      {/* Watchlist Tab */}
      {tab === "watchlist" && !loading && (
        figures.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#6e7681]">收藏清單是空的</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {figures.map((fig) => (
              <div key={fig.id} className="flex flex-col">
                <FigureCard
                  id={fig.id}
                  name={fig.name}
                  manufacturer={fig.manufacturer}
                  image_url={fig.image_url}
                  retail_price={fig.retail_price}
                  retail_currency={fig.retail_currency}
                  current_median_price={fig.current_median_price}
                  price_change_pct={fig.price_change_pct}
                  currency={currency}
                />
                <button
                  onClick={() => handleMarkPurchased(fig.id, fig.name)}
                  className="mt-1.5 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[10px] text-[#8b949e] transition-colors hover:border-[#3fb950]/50 hover:text-[#3fb950]"
                >
                  移動至已購入
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Purchases Tab */}
      {tab === "purchases" && (
        purchases.length === 0 ? (
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] py-12 text-center text-sm text-[#6e7681]">
            還沒有已購入的公仔
            <p className="mt-1 text-xs text-[#484f58]">從收藏清單將公仔標記為已購入即可開始記帳</p>
          </div>
        ) : (
          <div className="space-y-3">
            {purchases.map((p) => (
              <PurchaseCard key={p.id} purchase={p} onDelete={() => handleDeletePurchase(p.id)} />
            ))}
          </div>
        )
      )}

      {markFigure && (
        <MarkAsPurchasedModal
          figureId={markFigure.id}
          figureName={markFigure.name}
          onClose={() => setMarkFigure(null)}
          onSuccess={() => {
            removeFromWatchlist(markFigure.id);
            refreshPurchases();
            refreshUser();
          }}
        />
      )}
    </div>
  );
}

function PurchaseCard({ purchase: p, onDelete }: { purchase: Purchase; onDelete: () => void }) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [addingPrice, setAddingPrice] = useState(false);
  const [notes, setNotes] = useState(p.notes || "");
  const [saving, setSaving] = useState(false);
  const { token, refreshUser } = useAuth();
  const { refresh } = usePurchases();

  const hasPrice = p.price != null && p.currency != null;

  const saveNotes = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/user/purchases/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ private_notes: notes || null }),
      });
      setEditingNotes(false);
      refresh();
    } catch {}
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
      <div className="flex items-start gap-3">
        <a href={`/figures/${p.figure_id}`} className="shrink-0">
          {p.figure_image ? (
            <img src={p.figure_image} alt={p.figure_name} className="h-16 w-16 rounded border border-[#30363d] object-contain" />
          ) : (
            <div className="h-16 w-16 rounded border border-[#30363d] bg-[#161b22]" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <a href={`/figures/${p.figure_id}`} className="text-sm font-medium text-[#c9d1d9] hover:text-[#C4A265]">
            {p.figure_name}
          </a>
          {p.manufacturer && <p className="text-[10px] text-[#6e7681]">{p.manufacturer}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {hasPrice ? (
              <span className="font-bold text-[#C4A265]">
                {p.currency} {p.price!.toLocaleString()}
              </span>
            ) : (
              <span className="rounded-full border border-dashed border-[#30363d] px-2 py-0.5 text-[10px] text-[#6e7681]">
                未記錄價格
              </span>
            )}
            {p.condition && CONDITION_LABELS[p.condition] && (
              <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                {CONDITION_LABELS[p.condition]}
              </span>
            )}
            {p.purchase_date && (
              <span className="text-[10px] text-[#484f58]">
                {new Date(p.purchase_date).toLocaleDateString("zh-TW")}
              </span>
            )}
          </div>
          {!editingNotes && !addingPrice && p.notes && (
            <p className="mt-1.5 text-xs text-[#8b949e]">{p.notes}</p>
          )}

          {editingNotes && (
            <div className="mt-2 flex gap-1">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="備註..."
                className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#c9d1d9] focus:border-[#C4A265] focus:outline-none"
              />
              <button onClick={saveNotes} disabled={saving} className="rounded bg-[#C4A265] px-2 py-1 text-[10px] text-white disabled:opacity-50">
                儲存
              </button>
              <button onClick={() => { setNotes(p.notes || ""); setEditingNotes(false); }} className="text-[10px] text-[#6e7681]">
                取消
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {!hasPrice && !addingPrice && !editingNotes && (
            <button
              onClick={() => setAddingPrice(true)}
              className="rounded border border-[#C4A265]/30 px-2 py-1 text-[10px] text-[#C4A265] transition-colors hover:bg-[#C4A265]/10"
            >
              + 補填價格
            </button>
          )}
          {!editingNotes && !addingPrice && (
            <button
              onClick={() => setEditingNotes(true)}
              className="rounded px-2 py-1 text-[10px] text-[#8b949e] hover:text-[#C4A265]"
              title={p.notes ? "編輯備註" : "新增備註"}
            >
              {p.notes ? "編輯備註" : "+ 備註"}
            </button>
          )}
          <button
            onClick={onDelete}
            className="rounded px-2 py-1 text-[10px] text-[#f85149] hover:bg-[#f85149]/10"
          >
            移除
          </button>
        </div>
      </div>

      {addingPrice && (
        <div className="mt-3">
          <ReportForm
            figureId={String(p.figure_id)}
            title="補填購買紀錄"
            submitLabel="儲存"
            successMessage="已儲存"
            dateLabel="購買日期"
            showAttribution={false}
            compact={true}
            onCancel={() => setAddingPrice(false)}
            onSubmit={async (data) => {
              if (!token) return { ok: false, error: "請先登入" };
              try {
                const res = await fetch(`${API_BASE}/user/purchases/${p.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    price: data.price,
                    currency: data.currency,
                    condition: data.condition,
                    purchase_date: data.sold_at || null,
                    platform: data.platform || null,
                    notes: data.notes || null,
                    create_report: true,
                  }),
                });
                if (res.ok) {
                  setAddingPrice(false);
                  refresh();
                  refreshUser();
                  return { ok: true };
                }
                const err = await res.json().catch(() => ({}));
                return { ok: false, error: err.detail || "儲存失敗" };
              } catch {
                return { ok: false, error: "網路錯誤" };
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
