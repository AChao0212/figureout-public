"use client";

import { useState, useEffect } from "react";

export default function FigureRating({ figureId, initialAvg, initialCount }: { figureId: string; initialAvg: number | null; initialCount: number }) {
  const [avg, setAvg] = useState(initialAvg);
  const [count, setCount] = useState(initialCount);
  const [myRating, setMyRating] = useState(0);
  const [hovering, setHovering] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const handleRate = async (rating: number) => {
    setMyRating(rating);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("figureout_token") : null;
      await fetch(`${apiUrl}/figures/${figureId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rating }),
      });
      setSubmitted(true);
      // Refresh rating
      const res = await fetch(`${apiUrl}/figures/${figureId}/rating`);
      if (res.ok) {
        const data = await res.json();
        setAvg(data.average);
        setCount(data.count);
      }
    } catch {}
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill={star <= displayRating ? "#C4A265" : "none"} stroke={star <= displayRating ? "#C4A265" : "#484f58"} strokeWidth="1.5">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        ))}
      </div>
      <div className="text-xs text-[#6e7681]">
        {avg ? `${avg.toFixed(1)}` : "--"}
        <span className="ml-1 text-[#484f58]">({count})</span>
      </div>
      {submitted && <span className="text-[10px] text-[#3fb950]">已評分</span>}
    </div>
  );
}
