"use client";

import { useState, useEffect } from "react";

export default function FigureRating({ figureId, initialAvg, initialCount }: { figureId: string; initialAvg: number | null; initialCount: number }) {
 const [avg, setAvg] = useState(initialAvg);
 const [count, setCount] = useState(initialCount);
 const [myRating, setMyRating] = useState(0);
 const [hovering, setHovering] = useState(0);
 const [submitted, setSubmitted] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);

 const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

 const handleRate = async (rating: number) => {
 if (busy) return;
 setBusy(true);
 setError(null);
 setMyRating(rating);
 try {
 const token = typeof window !== "undefined" ? localStorage.getItem("figureout_token") : null;
 const res = await fetch(`${apiUrl}/figures/${figureId}/rating`, {
 method: "POST",
 headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
 body: JSON.stringify({ rating }),
      });
 if (res.status === 429) {
 setError("評分太頻繁，請稍後再試");
 setMyRating(0);
 return;
      }
 if (!res.ok) {
 setError("評分失敗");
 setMyRating(0);
 return;
      }
 setSubmitted(true);
 const refresh = await fetch(`${apiUrl}/figures/${figureId}/rating`);
 if (refresh.ok) {
 const data = await refresh.json();
 setAvg(data.average);
 setCount(data.count);
      }
    } catch {
 setError("網路錯誤");
 setMyRating(0);
    } finally {
 setBusy(false);
    }
  };

 const displayRating = hovering || myRating || Math.round(avg || 0);

 return (
    <div className="flex items-center gap-3">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
 key={star}
 onClick={() => handleRate(star)}
 onMouseEnter={() => setHovering(star)}
 onMouseLeave={() => setHovering(0)}
 className="p-0.5 transition-transform hover:scale-110"
 title={`${star} 分`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={star <= displayRating ? "var(--ink)" : "none"} stroke={star <= displayRating ? "var(--ink)" : "var(--muted)"} strokeWidth="1.5">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        ))}
      </div>
      <div className="text-xs text-[var(--muted)]">
        {avg ? `${avg.toFixed(1)}` : "--"}
        <span className="ml-1 text-[var(--muted)]">({count})</span>
      </div>
      {submitted && !error && <span className="text-[10px] text-[var(--hue-green)]">已評分</span>}
      {error && <span className="text-[10px] text-[var(--hue-red)]">{error}</span>}
    </div>
  );
}
