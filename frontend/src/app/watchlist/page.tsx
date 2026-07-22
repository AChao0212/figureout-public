"use client";

import { Suspense } from "react";
import WatchlistPageContent from "@/components/WatchlistPage";

export default function WatchlistRoute() {
  return (
    <Suspense fallback={<p className="col py-16 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">載入中</p>}>
      <WatchlistPageContent />
    </Suspense>
  );
}
