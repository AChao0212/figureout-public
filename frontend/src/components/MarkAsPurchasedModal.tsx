"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import ReportForm from "./ReportForm";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ReportItem {
 id: number;
 price: number;
 currency: string;
 condition?: string;
 platform?: string;
 notes?: string;
 created_at?: string;
  // Transaction date — joined from the listings row mirroring this report
  // (listings.sold_at). What the user actually entered on the report form's
  // 「成交日期」 input. Prefer this over created_at for display.
 sold_at?: string | null;
  // Community-report fields (only present on /figure-reports endpoint)
 user_id?: number | null;
 reporter?: string | null;
 is_mine?: boolean;
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

type SelectTab = "mine" | "community";

export default function MarkAsPurchasedModal({ figureId, figureName, onClose, onSuccess }: Props) {
 const { token } = useAuth();
 const [step, setStep] = useState<"choose" | "select" | "create">("choose");
 const [selectTab, setSelectTab] = useState<SelectTab>("mine");
 const [myReports, setMyReports] = useState<ReportItem[]>([]);
 const [communityReports, setCommunityReports] = useState<ReportItem[]>([]);
 const [loading, setLoading] = useState(false);
 const [fetchingList, setFetchingList] = useState(false);
 const [error, setError] = useState("");

 useEffect(() => {
 if (step !== "select" || !token) return;
 setFetchingList(true);
 const endpoint = selectTab === "mine" ? "my-reports" : "figure-reports";
 fetch(`${API_URL}/user/purchases/${endpoint}/${figureId}`, {
 headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ReportItem[]) => {
 if (selectTab === "mine") setMyReports(data);
 else setCommunityReports(data);
      })
      .catch(() => {
 if (selectTab === "mine") setMyReports([]);
 else setCommunityReports([]);
      })
      .finally(() => setFetchingList(false));
  }, [step, figureId, token, selectTab]);

 const handleSelectReport = async (reportId: number) => {
 if (!token) { setError("請重新登入"); return; }
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
 const err = await res.json().catch(() => ({}));
 setError(err.detail || "失敗");
      }
    } catch {
 setError("網路錯誤");
    }
 setLoading(false);
  };


 const handleSkip = async () => {
    // Just mark as purchased with no details
 if (!token) { setError("請重新登入"); return; }
 setLoading(true);
 setError("");
 try {
 const res = await fetch(`${API_URL}/user/purchases/${figureId}`, {
 method: "POST",
 headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
 body: JSON.stringify({}),
      });
 if (res.ok) {
 onSuccess();
 onClose();
      } else {
 const err = await res.json().catch(() => ({}));
 setError(err.detail || "操作失敗");
      }
    } catch {
 setError("網路錯誤");
    }
 setLoading(false);
  };

 const activeReports = selectTab === "mine" ? myReports : communityReports;

 const ReportCard = ({ r }: { r: ReportItem }) => (
    <button
 key={r.id}
 onClick={() => handleSelectReport(r.id)}
 disabled={loading}
 className={
        "w-full border p-3 text-left transition-colors disabled:opacity-50 " +
        (r.is_mine
          ? "border-[var(--ink)]/40 bg-[var(--ink)]/5 hover:border-[var(--ink)]/70"
          : "border-[var(--rule)] bg-[var(--ground-lift)] hover:border-[var(--ink)]")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--ink)]">
          {r.currency} {r.price.toLocaleString()}
        </span>
        <span className="text-[10px] text-[var(--ink-2)]">
          {CONDITION_LABELS[r.condition || ""] || r.condition}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--muted)]">
        {/* Prefer transaction date (成交日) — user expects to see WHEN the
 purchase happened, not when the report was filed. Fall back to
 created_at if the listings join didn't yield a sold_at (e.g.
 flagged reports that don't create a Listing row). */}
        <span>{(() => {
 const d = r.sold_at || r.created_at;
 return d ? new Date(d).toLocaleDateString("zh-TW") : "";
        })()}</span>
        {r.platform && <span>· {r.platform}</span>}
        {selectTab === "community" && (
 r.reporter ? (
            <span className={r.is_mine ? "text-[var(--ink)] font-medium" : "text-[var(--muted)]"}>
              · {r.is_mine ? "我" : `@${r.reporter}`}
            </span>
          ) : (
            <span className="text-[var(--muted)]">· 匿名</span>
          )
        )}
      </div>
      {r.notes && (
        <p className="mt-1 text-[11px] text-[var(--ink-2)] line-clamp-2">
          {r.notes}
        </p>
      )}
    </button>
  );

 return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md border border-[var(--rule)] bg-[var(--ground)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-medium text-[var(--ink)]">標記為已購入</h3>
            <p className="mt-0.5 truncate text-xs text-[var(--ink-2)]">{figureName}</p>
          </div>
          <button onClick={onClose} className="text-xl text-[var(--muted)] hover:text-[var(--ink)]">&times;</button>
        </div>

        {error && (
          <p className="mb-3 text-[13px] text-[var(--hue-red)]">
            {error}
          </p>
        )}

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--ink)]">要記錄這次購買的價格嗎？</p>
            <button
 onClick={() => setStep("select")}
 className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-4 py-3 text-left transition-colors hover:border-[var(--ink)]"
            >
              <p className="text-sm font-medium text-[var(--ink)]">從既有價格回報選取</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">從你或社群回報過的價格中挑一筆作為購買紀錄</p>
            </button>
            <button
 onClick={() => setStep("create")}
 className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-4 py-3 text-left transition-colors hover:border-[var(--ink)]"
            >
              <p className="text-sm font-medium text-[var(--ink)]">新增購買紀錄</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">填寫購買價格與日期，同時自動回報給社群</p>
            </button>
            <button
 type="button"
 onClick={handleSkip}
 disabled={loading}
 className="w-full border border-[var(--rule)] bg-[var(--ground)] px-4 py-3 text-left text-sm text-[var(--ink-2)] transition-colors hover:border-[var(--rule)] hover:text-[var(--ink)] disabled:opacity-50"
            >
              <p className="font-medium">略過，只標記為已購入</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">之後再補填價格</p>
            </button>
          </div>
        )}

        {step === "select" && (
          <div>
            <button onClick={() => setStep("choose")} className="mb-2 text-xs text-[var(--ink)] hover:underline">
              ← 返回
            </button>

            {/* Tab switcher */}
            <div className="mb-4 flex gap-x-6 border-b border-[var(--rule-faint)] pb-3">
              <button type="button" onClick={() => setSelectTab("mine")} aria-pressed={selectTab === "mine"} className="seg">
                我的回報
              </button>
              <button type="button" onClick={() => setSelectTab("community")} aria-pressed={selectTab === "community"} className="seg">
                社群回報
              </button>
            </div>

            {selectTab === "community" && (
              <p className="mb-2 text-[10px] text-[var(--muted)]">
                包含所有使用者的回報（含匿名）。選擇後只會把價格資料記到你的購買紀錄，不會修改原回報。
              </p>
            )}

            {fetchingList ? (
              <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">載入中</p>
            ) : activeReports.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-[var(--ink-2)]">
                {selectTab === "mine"
                  ? "你還沒有為這個公仔回報過價格"
                  : "社群尚未有這個公仔的價格回報"}
                <button onClick={() => setStep("create")} className="mt-2 block w-full text-xs text-[var(--ink)] hover:underline">
                  改為新增購買紀錄 →
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {activeReports.map((r) => <ReportCard key={r.id} r={r} />)}
              </div>
            )}
          </div>
        )}

        {step === "create" && (
          <div>
            <button onClick={() => setStep("choose")} className="mb-2 text-xs text-[var(--ink)] hover:underline">
              ← 返回
            </button>
            <ReportForm
 figureId={String(figureId)}
 title="新增購買紀錄"
 submitLabel="儲存"
 successMessage="已儲存"
 dateLabel="購買日期"
 notesLabel="備註（公開回報，選填）"
 notesPlaceholder="成交頁面連結..."
 notesHint="此備註會顯示在公仔詳細頁的成交紀錄，請勿填寫個人隱私資訊"
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
