"use client";

import { Suspense } from "react";
import WatchlistPageContent from "@/components/WatchlistPage";

export default function WatchlistRoute() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 48, color: "#8b949e" }}>載入中...</div>}>
      <WatchlistPageContent />
    </Suspense>
  );
}
