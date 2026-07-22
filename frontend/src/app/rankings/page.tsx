"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthContext";
import Link from "next/link";

interface RankingEntry {
 user_id: number;
 username: string;
 display_name: string | null;
 role: string;
 report_count: number;
 note_count: number;
}

const roleBadge: Record<string, { label: string; cls: string }> = {
 admin: { label: "管理員", cls: "bg-[var(--ink)]/20 text-[var(--ink)]" },
 editor: { label: "編輯者", cls: "bg-blue-900/30 text-blue-400" },
};

export default function RankingsPage() {
 const { user, token } = useAuth();
 const [rankings, setRankings] = useState<RankingEntry[]>([]);
 const [loading, setLoading] = useState(true);
 const [applyMsg, setApplyMsg] = useState("");
 const [showApplyForm, setShowApplyForm] = useState(false);
 const [applyReason, setApplyReason] = useState("");
 const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

 useEffect(() => {
 fetch(`${apiUrl}/user/rankings`)
      .then((r) => r.ok ? r.json() : [])
      .then(setRankings)
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [apiUrl]);

 const handleApply = async () => {
 if (!token) return;
 if (!applyReason.trim()) { setApplyMsg("請填寫申請理由"); return; }
 setApplyMsg("");
 try {
 const res = await fetch(`${apiUrl}/user/apply-editor`, {
 method: "POST",
 headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
 body: JSON.stringify({ reason: applyReason.trim() }),
      });
 const data = await res.json();
 if (res.ok) {
 setApplyMsg(data.message || "申請已送出");
 setShowApplyForm(false);
 setApplyReason("");
      } else {
 setApplyMsg(data.detail || "申請失敗");
      }
    } catch {
 setApplyMsg("網路錯誤");
    }
  };

 const medalColors = ["text-[var(--ink)]", "text-[var(--ink-2)]", "text-[#a0522d]"];

 return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-[var(--ink)] sm:text-2xl">貢獻排行榜</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">感謝每一位回報價格的使用者</p>
        </div>
        {user && user.role === "user" && (
          <button
 onClick={() => setShowApplyForm(!showApplyForm)}
 className="shrink-0 border border-[var(--rule)] px-3 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--ink)]/50 hover:text-[var(--ink)]"
          >
            {showApplyForm ? "取消" : "申請成為編輯者"}
          </button>
        )}
      </div>

      {showApplyForm && (
        <div className="mb-4 border border-[var(--ink)]/30 bg-[var(--ground)] p-4">
          <p className="mb-2 text-xs text-[var(--ink-2)]">請簡述你想成為編輯者的原因</p>
          <textarea
 value={applyReason}
 onChange={(e) => setApplyReason(e.target.value)}
 placeholder="例如：我是社團活躍成員，想幫忙整理資料..."
 maxLength={200}
 rows={2}
 className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--muted)] focus:border-[var(--ink)] focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[var(--muted)]">{applyReason.length}/200</span>
            <button onClick={handleApply} className="bg-[var(--ink)] px-4 py-1.5 text-xs font-medium text-[var(--ground)] hover:bg-[var(--ink-2)]">
              送出申請
            </button>
          </div>
        </div>
      )}

      {applyMsg && (
        <div className={`mb-4 px-3 py-2 text-xs ${applyMsg.includes("已送出") ? "bg-green-900/30 text-green-400" : "bg-[var(--ink)]/10 text-[var(--ink)]"}`}>
          {applyMsg}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--muted)]">載入中...</div>
      ) : rankings.length === 0 ? (
        <div className="border border-[var(--rule)] bg-[var(--ground)] py-16 text-center">
          <p className="text-sm text-[var(--muted)]">還沒有人上榜</p>
          <p className="mt-1 text-xs text-[var(--muted)]">登入並回報價格即可上榜</p>
          {!user && (
            <Link href="/login" className="mt-4 inline-block bg-[var(--ink)] px-6 py-2 text-sm font-medium text-[var(--ground)] hover:bg-[var(--ink-2)]">
              立即註冊
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto border border-[var(--rule)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ink-2)]">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ink-2)]">使用者</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ink-2)]">價格回報</th>
                <th className="hidden px-4 py-3 text-right text-xs font-medium text-[var(--ink-2)] sm:table-cell">筆記</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((entry, i) => (
                <tr key={entry.user_id} className={`border-b border-[var(--ground-lift)] transition-colors hover:bg-[var(--ground-lift)] ${user && entry.user_id === user.id ? "bg-[var(--ink)]/5" : ""}`}>
                  <td className="px-4 py-3">
                    {i < 3 ? (
                      <span className={`text-base font-medium ${medalColors[i]}`}>
                        {i === 0 ? "1st" : i === 1 ? "2nd" : "3rd"}
                      </span>
                    ) : (
                      <span className="text-sm text-[var(--muted)]">{i + 1}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${i < 3 ? "text-[var(--ink)]" : "text-[var(--ink)]"}`}>
                        {entry.display_name || entry.username}
                      </span>
                      {roleBadge[entry.role] && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[entry.role].cls}`}>
                          {roleBadge[entry.role].label}
                        </span>
                      )}
                      {user && entry.user_id === user.id && (
                        <span className="text-[10px] text-[var(--ink)]">(你)</span>
                      )}
                    </div>
                    {entry.display_name && entry.display_name !== entry.username && (
                      <span className="text-xs text-[var(--muted)]">@{entry.username}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${i < 3 ? "text-[var(--ink)]" : "text-[var(--ink)]"}`}>
                      {entry.report_count}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-right sm:table-cell">
                    <span className="text-[var(--ink-2)]">{entry.note_count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
