"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { formatCurrency } from "@/lib/currency";

interface Order {
  id: number;
  order_type: string;
  price: number;
  currency: string;
  condition: string;
  notes?: string;
  created_at?: string;
  user_id: number;
  username: string;
  display_name?: string;
}

const CONDITION_LABELS: Record<string, string> = {
  sealed: "全新", opened: "拆檢", used: "拆擺", damaged: "瑕疵",
};

export default function TradingBoard({ figureId }: { figureId: string }) {
  const { user, token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [contactVisible, setContactVisible] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);

  // Form state
  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("TWD");
  const [condition, setCondition] = useState("sealed");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const fetchOrders = () => {
    fetch(`${apiUrl}/figures/${figureId}/board`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setOrders)
      .catch(() => {
        setToast({ type: "error", msg: "載入交易看板失敗" });
        setTimeout(() => setToast(null), 3000);
      });
  };

  useEffect(() => { fetchOrders(); }, [figureId, apiUrl]);

  const handleSubmit = async () => {
    if (!price || !contact.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/board`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_type: orderType, price: parseInt(price), currency, condition, contact: contact.trim(), notes: notes.trim() || null }),
      });
      if (res.ok) {
        setToast({ type: "success", msg: "已發布" });
        setShowForm(false);
        setPrice(""); setContact(""); setNotes("");
        fetchOrders();
      } else {
        const err = await res.json();
        setToast({ type: "error", msg: err.detail || "發布失敗" });
      }
    } catch {
      setToast({ type: "error", msg: "網路錯誤" });
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (orderId: number) => {
    if (!confirm("確定要刪除此交易單？")) return;
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/board/${orderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: "error", msg: err.detail || "刪除失敗" });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      fetchOrders();
    } catch {
      setToast({ type: "error", msg: "網路錯誤" });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleShowContact = async (orderId: number) => {
    if (!token) { window.location.href = "/login"; return; }
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/board/${orderId}/contact`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: "error", msg: err.detail || "取得聯絡方式失敗" });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      const data = await res.json();
      setContactVisible((prev) => ({ ...prev, [orderId]: data.contact }));
    } catch {
      setToast({ type: "error", msg: "網路錯誤" });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const buyOrders = orders.filter((o) => o.order_type === "buy");
  const sellOrders = orders.filter((o) => o.order_type === "sell");

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
    return d.toLocaleDateString("zh-TW");
  };

  const OrderRow = ({ o }: { o: Order }) => (
    <div className="border-b border-[var(--rule-faint)] py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* price and condition on one line, but the condition is muted mono
              so the line still reads as one weight of ink */}
          <div className="flex items-baseline gap-2.5">
            <span className="num text-[16px] text-[var(--ink)]">{formatCurrency(o.price, o.currency)}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {CONDITION_LABELS[o.condition] || o.condition}
            </span>
          </div>
          {o.notes && <p className="mt-1.5 text-[13px] text-[var(--ink-2)]">{o.notes}</p>}
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {o.display_name || o.username} · {formatDate(o.created_at)}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {contactVisible[o.id] ? (
            <span className="text-[13px] text-[var(--ink)]">{contactVisible[o.id]}</span>
          ) : (
            <button
              type="button"
              onClick={() => handleShowContact(o.id)}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
            >
              我有興趣
            </button>
          )}
          {user && (user.id === o.user_id || user.role === "admin") && (
            <button
              type="button"
              onClick={() => handleDelete(o.id)}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:text-[var(--hue-red)]"
            >
              刪除
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const Column = ({ label, list, empty }: { label: string; list: Order[]; empty: string }) => (
    <div>
      <div className="flex items-baseline gap-2 border-b border-[var(--rule)] pb-2">
        <span className="sec-title text-[16px]">{label}</span>
        <span className="num text-[12px] text-[var(--muted)]">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--muted)]">{empty}</p>
      ) : (
        list.map((o) => <OrderRow key={o.id} o={o} />)
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 pb-5">
        <h2 className="sec-title">交易看板</h2>
        {user ? (
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            {showForm ? "取消" : "發布求購/出售 ↗"}
          </button>
        ) : (
          <a href="/login" className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]">
            登入後發布 ↗
          </a>
        )}
      </div>

      {toast && (
        <p
          className={`pb-4 text-[13px] ${
            toast.type === "success" ? "text-[var(--hue-green)]" : "text-[var(--hue-red)]"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {showForm && (
        <div className="mb-8 border-t border-[var(--rule)] pt-6">
          <div className="flex gap-x-8 border-b border-[var(--rule-faint)] pb-4">
            <button
              type="button"
              onClick={() => setOrderType("buy")}
              aria-pressed={orderType === "buy"}
              className="seg"
              style={orderType === "buy" ? { color: "var(--hue-green)" } : undefined}
            >
              求購
            </button>
            <button
              type="button"
              onClick={() => setOrderType("sell")}
              aria-pressed={orderType === "sell"}
              className="seg"
              style={orderType === "sell" ? { color: "var(--hue-red)" } : undefined}
            >
              出售
            </button>
          </div>

          <div className="grid grid-cols-1 gap-7 pt-6 sm:grid-cols-2">
            <div>
              <label className="lbl">價格</label>
              <div className="field">
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="3000"
                />
                <button
                  type="button"
                  onClick={() => setCurrency(currency === "TWD" ? "JPY" : currency === "JPY" ? "CNY" : currency === "CNY" ? "USD" : "TWD")}
                  className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
                >
                  {currency}
                </button>
              </div>
            </div>
            <div>
              <label className="lbl">狀態</label>
              <div className="field">
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  <option value="sealed">未拆</option>
                  <option value="opened">拆檢</option>
                  <option value="used">拆擺</option>
                  <option value="damaged">瑕疵</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-7">
            <label className="lbl">聯絡方式（僅對方點「我有興趣」後可見）</label>
            <div className="field">
              <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Line ID / FB / Discord…" />
            </div>
          </div>

          <div className="pt-7">
            <label className="lbl">備註（選填）</label>
            <div className="field">
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="附圖片連結、交易地點等" />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !price || !contact.trim()}
            className="mt-8 w-full bg-[var(--ink)] py-3 text-[14px] font-medium text-[var(--ground)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {submitting ? "發布中…" : "發布"}
          </button>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="rule py-10 text-center text-[14px] text-[var(--ink-2)]">
          還沒有交易單，成為第一個發布的人吧
        </p>
      ) : (
        <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
          <Column label="求購" list={buyOrders} empty="暫無求購單" />
          <Column label="出售" list={sellOrders} empty="暫無出售單" />
        </div>
      )}
    </div>
  );
}
