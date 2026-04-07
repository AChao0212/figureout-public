"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  figureId: number;
}

export default function ErrorReportButton({ figureId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState("error");
  const [desc, setDesc] = useState("");
  const [contact, setContact] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const inputClass =
    "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#c9d1d9] placeholder-gray-500 focus:border-[#C4A265] focus:outline-none focus:ring-1 focus:ring-[#C4A265]";

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!desc.trim()) return;
    setLoading(true);
    try {
      await fetch(`${apiUrl}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figure_id: figureId,
          report_type: type,
          description: desc,
          contact: contact || null,
        }),
      });
      setSubmitted(true);
      setTimeout(() => { setIsOpen(false); setSubmitted(false); setDesc(""); setContact(""); }, 2000);
    } catch {
      alert("送出失敗，請稍後再試");
    }
    setLoading(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
        aria-label="回報問題"
        title="回報問題"
        style={{
          width: 36,
          height: 36,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "50%",
          background: isOpen ? "rgba(248,81,73,0.15)" : "rgba(0,0,0,0.5)",
          cursor: "pointer",
          transition: "background 0.15s, transform 0.15s",
          flexShrink: 0,
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.15)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isOpen ? "#f85149" : "#6e7681"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[#30363d] bg-[#0d1117] p-4 shadow-xl sm:w-80">
          {submitted ? (
            <div className="rounded-lg border border-green-800 bg-green-900/30 px-3 py-3 text-center text-xs text-green-400">
              感謝回報！我們會盡快處理。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#c9d1d9]">回報問題</h3>
                <button onClick={() => setIsOpen(false)} className="text-sm text-[#6e7681] hover:text-[#c9d1d9]">&times;</button>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#6e7681]">問題類型</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                  <option value="error">資料錯誤</option>
                  <option value="wrong_info">資訊有誤</option>
                  <option value="duplicate">重複資料</option>
                  <option value="missing">缺少資訊</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#6e7681]">問題描述</label>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="請描述問題..." rows={2} className={inputClass} />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#6e7681]">聯絡方式（選填）</label>
                <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email 或其他聯絡方式" className={inputClass} />
              </div>

              <button onClick={handleSubmit} disabled={loading || !desc.trim()}
                className="w-full rounded-lg bg-[#C4A265] py-2 text-sm font-medium text-white transition-colors hover:bg-[#B89255] disabled:opacity-50">
                {loading ? "送出中..." : "送出回報"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
