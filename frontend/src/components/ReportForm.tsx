"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

export interface ReportFormData {
  price: number;
  currency: string;
  condition: string;
  platform: string;
  notes: string;
  sold_at: string;
}

interface ReportFormProps {
  figureId: string;
  onSubmit?: (data: ReportFormData) => Promise<{ ok: boolean; error?: string }>;
  title?: string;
  submitLabel?: string;
  successMessage?: string;
  hidePlatform?: boolean;
  dateLabel?: string;
  onCancel?: () => void;
  compact?: boolean;
  showAttribution?: boolean;
}

export default function ReportForm({
  figureId,
  onSubmit,
  title = "回報成交價",
  submitLabel = "送出回報",
  successMessage = "回報成功，感謝你！",
  hidePlatform = false,
  dateLabel = "成交日期",
  onCancel,
  compact = false,
  showAttribution = true,
}: ReportFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const { user, token } = useAuth();
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  function getLocalToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const [today, setToday] = useState("2099-12-31");
  const [formData, setFormData] = useState({
    price: "",
    currency: "TWD",
    condition: "sealed",
    platform: "",
    notes: "",
    sold_at: "",
  });

  useEffect(() => {
    const t = getLocalToday();
    setToday(t);
    setFormData((f) => ({ ...f, sold_at: f.sold_at || t }));
  }, []);

  const resetForm = () => {
    setFormData({ price: "", currency: "TWD", condition: "sealed", platform: "", notes: "", sold_at: getLocalToday() });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setToast(null);

    const price = Math.round(parseFloat(formData.price));
    const data: ReportFormData = {
      price,
      currency: formData.currency,
      condition: formData.condition,
      platform: formData.platform,
      notes: formData.notes,
      sold_at: formData.sold_at,
    };

    try {
      if (onSubmit) {
        // Custom submit handler
        const result = await onSubmit(data);
        if (result.ok) {
          setToast({ type: "success", message: successMessage });
          resetForm();
        } else {
          setToast({ type: "error", message: result.error || "儲存失敗，請稍後再試。" });
        }
      } else {
        // Default: POST to /figures/{id}/report
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiUrl}/figures/${figureId}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
          body: JSON.stringify({ ...formData, price }),
        });
        if (!res.ok) throw new Error("Failed");
        setToast({ type: "success", message: successMessage });
        resetForm();
      }
    } catch {
      setToast({ type: "error", message: "送出失敗，請稍後再試。" });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-[#c9d1d9] placeholder-gray-500 focus:border-[#C4A265] focus:outline-none focus:ring-1 focus:ring-[#C4A265] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield] h-[42px] max-w-full box-border";

  const containerPadding = compact ? "p-3" : "p-3 sm:p-5";

  return (
    <div className="w-full">
      <div className={`rounded-lg border border-[#30363d] bg-[#0d1117] ${containerPadding} overflow-hidden`}>
        <h3 className="mb-3 text-sm font-semibold text-[#c9d1d9]">{title}</h3>

        {toast && (
          <div className={"mb-3 rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-xs " + (
            toast.type === "success" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
          )}>
            {toast.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">價格</label>
              <input type="number" step="1" min="1" required value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">幣別</label>
              <select value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className={inputClass}>
                <option value="TWD">TWD</option>
                <option value="JPY">JPY</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>

          <div className={hidePlatform ? "" : "grid grid-cols-2 gap-3"}>
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">商品狀態</label>
              <select value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                className={inputClass}>
                <option value="sealed">全新</option>
                <option value="opened">拆檢</option>
                <option value="used">拆擺</option>
                <option value="damaged">瑕疵</option>
              </select>
            </div>
            {!hidePlatform && (
              <div>
                <label className="mb-1 block text-xs text-[#6e7681]">交易平台</label>
                <input type="text" value={formData.platform}
                  onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                  className={inputClass} placeholder="FB、巴哈..." />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">{dateLabel}</label>
              <input type="date" value={formData.sold_at}
                style={{ minWidth: 0, WebkitAppearance: "none" }}
                max={today}
                onChange={(e) => setFormData({ ...formData, sold_at: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">備註（選填）</label>
              <input type="text" value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className={inputClass} placeholder="相關貼文連結" />
            </div>
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel}
                className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] transition-colors hover:text-[#c9d1d9]">
                取消
              </button>
            )}
            <button type="submit" disabled={submitting}
              className="flex-1 rounded-lg bg-[#C4A265] py-2 text-sm font-medium text-white transition-colors hover:bg-[#B89255] disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? "送出中..." : submitLabel}
            </button>
          </div>

          {showAttribution && (
            <p className="mt-1 text-center text-[10px] text-[#484f58]">
              {user ? "以 " + (user.display_name || user.username) + " 身分回報" : <><a href="/login" className="text-[#C4A265] hover:underline">登入</a>{"以記錄貢獻"}</>}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
