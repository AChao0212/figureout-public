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
    "w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-3 py-2 text-sm text-[var(--ink)] placeholder-gray-500 focus:border-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]";

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
        aria-expanded={isOpen}
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
      >
        回報錯誤
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 border border-[var(--rule)] bg-[var(--ground)] p-4 sm:w-80">
          {submitted ? (
            <p className="py-3 text-center text-[13px] text-[var(--hue-green)]">
              感謝回報！我們會盡快處理。
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--ink)]">回報問題</h3>
                <button onClick={() => setIsOpen(false)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button>
              </div>

              <div>
                <label className="lbl">問題類型</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                  <option value="error">資料錯誤</option>
                  <option value="wrong_info">資訊有誤</option>
                  <option value="duplicate">重複資料</option>
                  <option value="missing">缺少資訊</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div>
                <label className="lbl">問題描述</label>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="請描述問題..." rows={2} className={inputClass} />
              </div>

              <div>
                <label className="lbl">聯絡方式（選填）</label>
                <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email 或其他聯絡方式" className={inputClass} />
              </div>

              <button onClick={handleSubmit} disabled={loading || !desc.trim()}
 className="w-full bg-[var(--ink)] py-2.5 text-[14px] font-medium text-[var(--ground)] transition-opacity hover:opacity-80 disabled:opacity-50">
                {loading ? "送出中..." : "送出回報"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
