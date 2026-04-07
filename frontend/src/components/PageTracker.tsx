"use client";

import { useEffect } from "react";

export default function PageTracker({ page, figureId }: { page: string; figureId?: number }) {
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${apiUrl}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, figure_id: figureId || null }),
    }).catch(() => {});
  }, [page, figureId]);

  return null;
}
