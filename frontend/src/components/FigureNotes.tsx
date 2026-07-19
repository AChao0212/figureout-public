"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

interface Note {
  id: number;
  content: string;
  link_url?: string;
  created_at?: string;
  report_count: number;
}

export default function FigureNotes({ figureId }: { figureId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const { user, token } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{type: string; msg: string} | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiUrl}/figures/${figureId}/notes`)
      .then(r => r.json())
      .then(setNotes)
      .catch(() => {});
  }, [figureId, apiUrl]);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ content: content.trim(), link_url: linkUrl.trim() || null }),
      });
      if (res.ok) {
        setToast({ type: "success", msg: "筆記已新增" });
        setContent("");
        setLinkUrl("");
        setShowForm(false);
        // Refresh notes
        const r = await fetch(`${apiUrl}/figures/${figureId}/notes`);
        if (r.ok) setNotes(await r.json());
      } else {
        const err = await res.json();
        setToast({ type: "error", msg: err.detail || "送出失敗" });
      }
    } catch {
      setToast({ type: "error", msg: "送出失敗" });
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleReport = async (noteId: number) => {
    if (reportedIds.has(noteId)) return;
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/notes/${noteId}/report`, { method: "POST" });
      if (!res.ok) {
        setToast({ type: "error", msg: "檢舉失敗，請稍後再試" });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      setReportedIds(new Set([...reportedIds, noteId]));
      setNotes(notes.filter(n => n.id !== noteId));
    } catch {
      setToast({ type: "error", msg: "網路錯誤" });
      setTimeout(() => setToast(null), 3000);
    }
  };

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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#c9d1d9]">社群筆記</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg border border-[#30363d] px-3 py-1 text-xs text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
        >
          {showForm ? "取消" : "+ 新增筆記"}
        </button>
      </div>

      {toast && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${toast.type === "success" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
          {toast.msg}
        </div>
      )}

      {showForm && (
        <div className="mb-4 space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="分享你的心得、開箱體驗、注意事項..."
            maxLength={500}
            rows={2}
            className={inp}
          />
          <input
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            placeholder="相關連結 (選填) https://..."
            className={inp}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#484f58]">{content.length}/500</span>
            <button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="rounded-lg bg-[#C4A265] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#B89255] disabled:opacity-50"
            >
              {submitting ? "送出中..." : "送出"}
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 text-center text-xs text-[#6e7681]">
          還沒有筆記，成為第一個分享的人吧！
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
              <p className="text-sm text-[#c9d1d9]">{note.content}</p>
              {note.link_url && (
                <a
                  href={note.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-[#C4A265] hover:underline"
                >
                  {note.link_url.length > 50 ? note.link_url.slice(0, 50) + "..." : note.link_url}
                </a>
              )}
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[10px] text-[#484f58]">{formatDate(note.created_at)}</span>
                <button
                  onClick={() => handleReport(note.id)}
                  className={`text-[10px] transition-colors ${
                    reportedIds.has(note.id)
                      ? "text-[#3fb950]"
                      : "text-[#484f58] hover:text-[#f85149]"
                  }`}
                >
                  {reportedIds.has(note.id) ? "已檢舉" : "檢舉濫用"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
