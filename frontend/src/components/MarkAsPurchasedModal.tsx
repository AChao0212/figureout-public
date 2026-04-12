"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import ReportForm from "./ReportForm";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface MyReport {
  id: number;
  price: number;
  currency: string;
  condition?: string;
  platform?: string;
  notes?: string;
  created_at?: string;
}

interface Props {
  figureId: number;
  figureName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CONDITION_LABELS: Record<string, string> = {
  sealed: "全新", opened: "拆檢", used: "拆擺", damaged: "瑕疵",
};

export default function MarkAsPurchasedModal({ figureId, figureName, onClose, onSuccess }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<"choose" | "select" | "create">("choose");
  const [myReports, setMyReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step === "select" && token) {
      fetch(`${API_URL}/user/purchases/my-reports/${figureId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then(setMyReports)
        .catch(() => setMyReports([]));
    }
  }, [step, figureId, token]);

  const handleSelectReport = async (reportId: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/user/purchases/${figureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_report_id: reportId }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const err = await res.json();
        setError(err.detail || "失敗");
      }
    } catch {
      setError("網路錯誤");
    }
    setLoading(false);
  };


  const handleSkip = async () => {
    // Just mark as purchased with no details
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/user/purchases/${figureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch {}
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-[#30363d] bg-[#0d1117] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#e6edf3]">標記為已購入</h3>
            <p className="mt-0.5 truncate text-xs text-[#8b949e]">{figureName}</p>
          </div>
          <button onClick={onClose} className="text-xl text-[#6e7681] hover:text-[#c9d1d9]">&times;</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-[#f85149]">
            {error}
          </div>
        )}

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-[#c9d1d9]">要記錄這次購買的價格嗎？</p>
            <button
              onClick={() => setStep("select")}
              className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-3 text-left transition-colors hover:border-[#C4A265]/50"
            >
              <p className="text-sm font-medium text-[#c9d1d9]">從我的價格回報選取</p>
              <p className="mt-0.5 text-xs text-[#6e7681]">如果你之前已經回報過這次購買的價格</p>
            </button>
            <button
              onClick={() => setStep("create")}
              className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-3 text-left transition-colors hover:border-[#C4A265]/50"
            >
              <p className="text-sm font-medium text-[#c9d1d9]">新增購買紀錄</p>
              <p className="mt-0.5 text-xs text-[#6e7681]">填寫購買價格與日期，同時自動回報給社群</p>
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3 text-left text-sm text-[#8b949e] transition-colors hover:border-[#30363d] hover:text-[#c9d1d9] disabled:opacity-50"
            >
              <p className="font-medium">略過，只標記為已購入</p>
              <p className="mt-0.5 text-xs text-[#6e7681]">之後再補填價格</p>
            </button>
          </div>
        )}

        {step === "select" && (
          <div>
            <button onClick={() => setStep("choose")} className="mb-2 text-xs text-[#C4A265] hover:underline">
              ← 返回
            </button>
            {myReports.length === 0 ? (
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-center text-sm text-[#6e7681]">
                你還沒有為這個公仔回報過價格
                <button onClick={() => setStep("create")} className="mt-2 block w-full text-xs text-[#C4A265] hover:underline">
                  改為新增購買紀錄 →
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {myReports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelectReport(r.id)}
                    disabled={loading}
                    className="w-full rounded-lg border border-[#30363d] bg-[#161b22] p-3 text-left transition-colors hover:border-[#C4A265]/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#e6edf3]">
                        {r.currency} {r.price.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-[#8b949e]">
                        {CONDITION_LABELS[r.condition || ""] || r.condition}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[#484f58]">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString("zh-TW") : ""}
                      {r.platform && ` · ${r.platform}`}
                    </p>
                    {r.notes && (
                      <p className="mt-1 text-[11px] text-[#8b949e] line-clamp-2">
                        {r.notes}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "create" && (
          <div>
            <button onClick={() => setStep("choose")} className="mb-2 text-xs text-[#C4A265] hover:underline">
              ← 返回
            </button>
            <ReportForm
              figureId={String(figureId)}
              title="新增購買紀錄"
              submitLabel="儲存"
              successMessage="已儲存"
              dateLabel="購買日期"
              showAttribution={false}
              compact={true}
              onSubmit={async (data) => {
                if (!token) return { ok: false, error: "請先登入" };
                try {
                  const res = await fetch(`${API_URL}/user/purchases/${figureId}`, {
                    method: "POST",
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
                    onSuccess();
                    onClose();
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
    </div>
  );
}
