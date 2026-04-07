"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

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
const CURRENCY_SYMBOLS: Record<string, string> = {
  TWD: "$", JPY: "\u00a5", USD: "$", CNY: "\u00a5",
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
      .then((r) => r.json())
      .then(setOrders)
      .catch(() => {});
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
    await fetch(`${apiUrl}/figures/${figureId}/board/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchOrders();
  };

  const handleShowContact = async (orderId: number) => {
    if (!token) { window.location.href = "/login"; return; }
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/board/${orderId}/contact`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setContactVisible((prev) => ({ ...prev, [orderId]: data.contact }));
      }
    } catch {}
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

  const inp = "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#c9d1d9] placeholder-[#484f58] focus:border-[#C4A265] focus:outline-none";

  const OrderCard = ({ o }: { o: Order }) => (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[#e6edf3]">
              {CURRENCY_SYMBOLS[o.currency] || "$"}{o.price.toLocaleString()}
            </span>
            <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
              {CONDITION_LABELS[o.condition] || o.condition}
            </span>
          </div>
          {o.notes && <p className="mt-1 text-xs text-[#8b949e]">{o.notes}</p>}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#484f58]">
            <span>{o.display_name || o.username}</span>
            <span>{formatDate(o.created_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {contactVisible[o.id] ? (
            <div className="rounded-lg bg-[#C4A265]/10 px-2 py-1 text-[10px] text-[#C4A265]">
              {contactVisible[o.id]}
            </div>
          ) : (
            <button
              onClick={() => handleShowContact(o.id)}
              className="rounded-lg border border-[#C4A265]/30 px-2 py-1 text-[10px] text-[#C4A265] transition-colors hover:bg-[#C4A265]/10"
            >
              我有興趣
            </button>
          )}
          {user && (user.id === o.user_id || user.role === "admin") && (
            <button
              onClick={() => handleDelete(o.id)}
              className="rounded-lg px-2 py-1 text-[10px] text-[#f85149] transition-colors hover:bg-[#f85149]/10"
            >
              刪除
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#c9d1d9]">交易看板</h2>
        {user ? (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg border border-[#30363d] px-3 py-1 text-xs text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
          >
            {showForm ? "取消" : "+ 發布求購/出售"}
          </button>
        ) : (
          <a href="/login" className="rounded-lg border border-[#30363d] px-3 py-1 text-xs text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]">
            登入後發布
          </a>
        )}
      </div>

      {toast && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${toast.type === "success" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
          {toast.msg}
        </div>
      )}

      {showForm && (
        <div className="mb-4 space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
          <div className="flex gap-1 rounded-lg border border-[#30363d] bg-[#161b22] p-1">
            <button onClick={() => setOrderType("buy")} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${orderType === "buy" ? "bg-[#3fb950]/15 text-[#3fb950]" : "text-[#8b949e]"}`}>
              求購
            </button>
            <button onClick={() => setOrderType("sell")} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${orderType === "sell" ? "bg-[#f85149]/15 text-[#f85149]" : "text-[#8b949e]"}`}>
              出售
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-[#6e7681]">價格</label>
              <div className="flex">
                <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="3000" className={inp + " rounded-r-none"} />
                <button type="button" onClick={() => setCurrency(currency === "TWD" ? "JPY" : currency === "JPY" ? "CNY" : currency === "CNY" ? "USD" : "TWD")} className="shrink-0 rounded-r-lg border border-l-0 border-[#30363d] bg-[#161b22] px-2 text-[10px] font-medium text-[#C4A265]">
                  {currency}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#6e7681]">狀態</label>
              <select value={condition} onChange={(e) => setCondition(e.target.value)} className={inp}>
                <option value="sealed">未拆</option>
                <option value="opened">拆檢</option>
                <option value="used">拆擺</option>
                <option value="damaged">瑕疵</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-[#6e7681]">聯絡方式 (僅對方點擊「我有興趣」後可見)</label>
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Line ID / FB / Discord..." className={inp} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-[#6e7681]">備註 (選填)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="附圖片連結、交易地點等" className={inp} />
          </div>
          <button onClick={handleSubmit} disabled={submitting || !price || !contact.trim()} className="w-full rounded-lg bg-[#C4A265] py-2 text-sm font-medium text-white transition-colors hover:bg-[#B89255] disabled:opacity-50">
            {submitting ? "發布中..." : "發布"}
          </button>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 text-center text-xs text-[#6e7681]">
          還沒有交易單，成為第一個發布的人吧！
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#3fb950]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              求購 ({buyOrders.length})
            </h3>
            <div className="space-y-2">
              {buyOrders.length === 0 ? (
                <p className="text-xs text-[#484f58]">暫無求購單</p>
              ) : buyOrders.map((o) => <OrderCard key={o.id} o={o} />)}
            </div>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#f85149]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
              出售 ({sellOrders.length})
            </h3>
            <div className="space-y-2">
              {sellOrders.length === 0 ? (
                <p className="text-xs text-[#484f58]">暫無出售單</p>
              ) : sellOrders.map((o) => <OrderCard key={o.id} o={o} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
