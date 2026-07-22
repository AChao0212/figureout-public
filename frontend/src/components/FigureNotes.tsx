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
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiUrl}/figures/${figureId}/notes`)
      .then((r) => r.json())
      .then(setNotes)
      .catch(() => {});
  }, [figureId, apiUrl]);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/figures/${figureId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ content: content.trim(), link_url: linkUrl.trim() || null }),
      });
      if (res.ok) {
        setToast({ type: "success", msg: "筆記已新增" });
        setContent("");
        setLinkUrl("");
        setShowForm(false);
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
      setNotes(notes.filter((n) => n.id !== noteId));
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

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 pb-5">
        <h2 className="sec-title">社群筆記</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          {showForm ? "取消" : "新增筆記 ↗"}
        </button>
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
          <div className="field !items-start">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="分享你的心得、開箱體驗、注意事項…"
              maxLength={500}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="field mt-6">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="相關連結（選填）https://…"
            />
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="num text-[10px] tracking-[0.1em] text-[var(--muted)]">{content.length}/500</span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="bg-[var(--ink)] px-6 py-2.5 text-[13px] font-medium text-[var(--ground)] transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {submitting ? "送出中…" : "送出"}
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="rule py-10 text-center text-[14px] text-[var(--ink-2)]">
          還沒有筆記，成為第一個分享的人吧
        </p>
      ) : (
        <div className="rule-b">
          {notes.map((note) => (
            <div key={note.id} className="border-b border-[var(--rule-faint)] py-4">
              <p className="text-[14px] leading-relaxed text-[var(--ink)]">{note.content}</p>
              {note.link_url && (
                <a
                  href={note.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-[12px] text-[var(--ink-2)] underline-offset-2 transition-colors hover:text-[var(--ink)] hover:underline"
                >
                  {note.link_url.length > 50 ? note.link_url.slice(0, 50) + "…" : note.link_url}
                </a>
              )}
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em]">
                <span className="text-[var(--muted)]">{formatDate(note.created_at)}</span>
                <button
                  type="button"
                  onClick={() => handleReport(note.id)}
                  className={`tracking-[0.12em] transition-colors ${
                    reportedIds.has(note.id)
                      ? "text-[var(--hue-green)]"
                      : "text-[var(--muted)] hover:text-[var(--hue-red)]"
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
