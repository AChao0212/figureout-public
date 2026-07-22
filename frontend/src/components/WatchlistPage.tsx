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

type PurchaseSortKey =
  | "newest" | "oldest"
  | "date_desc" | "date_asc"
  | "price_desc" | "price_asc"
  | "name_asc";

/** Sort the purchase list client-side. Date sorts push undefined values to the bottom
 * so a half-filled "purchased without date" entry doesn't anchor the list. Prices
 * are normalized to TWD via live rates for cross-currency comparison. */
function sortPurchases(
 purchases: Purchase[],
 key: PurchaseSortKey,
 rates: Record<string, number>,
): Purchase[] {
 const arr = [...purchases];
 const cmpDate = (a?: string, b?: string) => (a ?? "").localeCompare(b ?? "");
 const priceTwd = (p: Purchase) =>
 p.price && p.currency ? convertCurrency(p.price, p.currency, "TWD", rates as any) : null;

 switch (key) {
 case "newest":
 return arr.sort((a, b) => cmpDate(b.created_at, a.created_at));
 case "oldest":
 return arr.sort((a, b) => cmpDate(a.created_at, b.created_at));
 case "date_desc":
 return arr.sort((a, b) => {
 const av = a.purchase_date, bv = b.purchase_date;
 if (av && bv) return cmpDate(bv, av);
 if (av) return -1; if (bv) return 1; return 0;
      });
 case "date_asc":
 return arr.sort((a, b) => {
 const av = a.purchase_date, bv = b.purchase_date;
 if (av && bv) return cmpDate(av, bv);
 if (av) return -1; if (bv) return 1; return 0;
      });
 case "price_desc":
 return arr.sort((a, b) => (priceTwd(b) ?? -Infinity) - (priceTwd(a) ?? -Infinity));
 case "price_asc":
 return arr.sort((a, b) => (priceTwd(a) ?? Infinity) - (priceTwd(b) ?? Infinity));
 case "name_asc":
 return arr.sort((a, b) => a.figure_name.localeCompare(b.figure_name));
  }
}

export default function WatchlistPage() {
 const { watchlist, removeFromWatchlist, clearWatchlist, refreshFromServer } = useWatchlist();
 const { purchases, refresh: refreshPurchases } = usePurchases();
 const { user, token, refreshUser } = useAuth();
 const rates = useExchangeRates();
 const [figures, setFigures] = useState<FigureData[]>([]);
 const [loading, setLoading] = useState(true);
 const [tab, setTab] = useState<"watchlist" | "purchases">("watchlist");
 const [markFigure, setMarkFigure] = useState<{ id: number; name: string } | null>(null);
  // Purchase list sort preference. "newest" = most recently added (default — matches
  // the previous implicit ordering by created_at desc from the API).
 const [purchaseSort, setPurchaseSort] = useState<
    "newest" | "oldest" | "date_desc" | "date_asc" | "price_desc" | "price_asc" | "name_asc"
  >("newest");

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
 fetch(`${API_BASE}/figures/${id}?currency=${encodeURIComponent(currency)}`).then((r) => {
 if (r.status === 404) {
            // Figure was deleted — drop it from the watchlist so it doesn't
            // become a phantom ID that we keep trying to fetch forever.
 throw Object.assign(new Error("not_found"), { status: 404, id });
          }
 if (!r.ok) throw Object.assign(new Error(`${r.status}`), { status: r.status, id });
 return r.json() as Promise<FigureData>;
        }),
      ),
    ).then((results) => {
 if (cancelled) return;
 setFigures(results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<FigureData>).value));
 setLoading(false);
      // Clean up watchlist entries pointing at 404 figures
 for (const r of results) {
 if (r.status === "rejected") {
 const err: any = r.reason;
 if (err && err.status === 404 && typeof err.id === "number") {
 removeFromWatchlist(err.id);
          }
        }
      }
    });
 return () => { cancelled = true; };
  }, [watchlist, removeFromWatchlist, currency]);

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
      <div className="col py-16 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <h2 className="text-xl font-medium text-[var(--ink)]">你的清單是空的</h2>
        <p className="mt-2 text-sm text-[var(--ink-2)]">瀏覽公仔並按下愛心即可加入收藏</p>
        <a href="/" className="mt-6 inline-block bg-[var(--ink)] px-6 py-2.5 text-sm font-medium text-[var(--ground)] transition-colors hover:bg-[var(--ink-2)]">
          回到首頁
        </a>
      </div>
    );
  }

 return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-medium text-[var(--ink)] sm:text-2xl">我的清單</h1>
        {tab === "purchases" && purchasesWithPrice > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-[var(--muted)]">總購入金額</p>
            <p className="text-lg font-medium text-[var(--ink)]">NT${Math.round(totalTwd).toLocaleString()}</p>
          </div>
        )}
        {tab === "watchlist" && watchlist.length > 0 && (
          <button
 type="button"
 onClick={clearWatchlist}
 className="border border-[var(--rule)] px-3 py-1.5 text-xs text-[var(--hue-red)] transition-colors hover:border-[var(--hue-red)]/50"
          >
            清空收藏
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto border border-[var(--rule)] bg-[var(--ground)] p-1">
        {tabs.map((t) => (
          <button
 key={t.key}
 onClick={() => setTab(t.key)}
 className={`shrink-0 px-3 py-2 text-sm font-medium transition-colors ${
 tab === t.key ? "bg-[var(--ground-lift)] text-[var(--ink)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-[var(--muted)]">{t.count}</span>
          </button>
        ))}
      </div>

      {loading && tab === "watchlist" && (
        <div className="py-12 text-center text-sm text-[var(--ink-2)]">載入中...</div>
      )}

      {/* Watchlist Tab */}
      {tab === "watchlist" && !loading && (
 figures.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted)]">收藏清單是空的</div>
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
 className="mt-1.5 border border-[var(--rule)] bg-[var(--ground)] px-2 py-1 text-[10px] text-[var(--ink-2)] transition-colors hover:border-[var(--hue-green)]/50 hover:text-[var(--hue-green)]"
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
          <div className="border border-[var(--rule)] bg-[var(--ground)] py-12 text-center text-sm text-[var(--muted)]">
            還沒有已購入的公仔
            <p className="mt-1 text-xs text-[var(--muted)]">從收藏清單將公仔標記為已購入即可開始記帳</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">排序</span>
              <select
 value={purchaseSort}
 onChange={(e) => setPurchaseSort(e.target.value as typeof purchaseSort)}
 className="border border-[var(--rule)] bg-[var(--ground)] px-2 py-1 text-xs text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              >
                <option value="newest">新增（新→舊）</option>
                <option value="oldest">新增（舊→新）</option>
                <option value="date_desc">購入日期（新→舊）</option>
                <option value="date_asc">購入日期（舊→新）</option>
                <option value="price_desc">價格（高→低）</option>
                <option value="price_asc">價格（低→高）</option>
                <option value="name_asc">名稱（A→Z）</option>
              </select>
            </div>
            <div className="space-y-3">
              {sortPurchases(purchases, purchaseSort, rates as unknown as Record<string, number>).map((p) => (
                <PurchaseCard key={p.id} purchase={p} onDelete={() => handleDeletePurchase(p.id)} />
              ))}
            </div>
          </>
        )
      )}

      {markFigure && (
        <MarkAsPurchasedModal
 figureId={markFigure.id}
 figureName={markFigure.name}
 onClose={() => setMarkFigure(null)}
 onSuccess={() => {
            // Backend removes from watchlist atomically with purchase create,
            // so we just re-sync instead of firing another DELETE.
 refreshFromServer().catch(() => {});
 refreshPurchases();
 refreshUser();
 setTab("purchases");
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
    <div className="border border-[var(--rule)] bg-[var(--ground)] p-3">
      <div className="flex items-start gap-3">
        <a href={`/figures/${p.figure_id}`} className="shrink-0">
          {p.figure_image ? (
            <img src={p.figure_image} alt={p.figure_name} className="h-16 w-16 border border-[var(--rule)] object-contain" />
          ) : (
            <div className="h-16 w-16 border border-[var(--rule)] bg-[var(--ground-lift)]" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <a href={`/figures/${p.figure_id}`} className="text-sm font-medium text-[var(--ink)] hover:text-[var(--ink)]">
            {p.figure_name}
          </a>
          {p.manufacturer && <p className="text-[10px] text-[var(--muted)]">{p.manufacturer}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {hasPrice ? (
              <span className="font-medium text-[var(--ink)]">
                {p.currency} {p.price!.toLocaleString()}
              </span>
            ) : (
              <span className="rounded-full border border-dashed border-[var(--rule)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                未記錄價格
              </span>
            )}
            {p.condition && CONDITION_LABELS[p.condition] && (
              <span className="rounded-full bg-[var(--ground-lift)] px-1.5 py-0.5 text-[10px] text-[var(--ink-2)]">
                {CONDITION_LABELS[p.condition]}
              </span>
            )}
            {p.purchase_date && (
              <span className="text-[10px] text-[var(--muted)]">
                {new Date(p.purchase_date).toLocaleDateString("zh-TW")}
              </span>
            )}
          </div>
          {!editingNotes && !addingPrice && p.notes && (
            <p className="mt-1.5 text-xs text-[var(--ink-2)]">{p.notes}</p>
          )}

          {editingNotes && (
            <div className="mt-2">
              <div className="flex gap-1">
                <input
 type="text"
 value={notes}
 onChange={(e) => setNotes(e.target.value)}
 placeholder="僅自己可見的備註..."
 className="flex-1 border border-[var(--rule)] bg-[var(--ground-lift)] px-2 py-1 text-xs text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
                />
                <button onClick={saveNotes} disabled={saving} className="bg-[var(--ink)] px-2 py-1 text-[10px] text-[var(--ground)] disabled:opacity-50">
                  儲存
                </button>
                <button onClick={() => { setNotes(p.notes || ""); setEditingNotes(false); }} className="text-[10px] text-[var(--muted)]">
                  取消
                </button>
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">此備註僅自己可見，不會送到社群紀錄</p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {!hasPrice && !addingPrice && !editingNotes && (
            <button
 onClick={() => setAddingPrice(true)}
 className="border border-[var(--ink)]/30 px-2 py-1 text-[10px] text-[var(--ink)] transition-colors hover:bg-[var(--ink)]/10"
            >
              + 補填價格
            </button>
          )}
          {!editingNotes && !addingPrice && (
            <button
 onClick={() => setEditingNotes(true)}
 className="px-2 py-1 text-[10px] text-[var(--ink-2)] hover:text-[var(--ink)]"
 title={p.notes ? "編輯備註" : "新增備註"}
            >
              {p.notes ? "編輯備註" : "+ 備註"}
            </button>
          )}
          <button
 onClick={onDelete}
 className="px-2 py-1 text-[10px] text-[var(--hue-red)] hover:bg-[var(--hue-red)]/10"
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
 notesLabel="備註（公開回報，選填）"
 notesPlaceholder="成交頁面連結..."
 notesHint="此備註會公開顯示在公仔詳細頁，請勿填寫個人隱私資訊"
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
