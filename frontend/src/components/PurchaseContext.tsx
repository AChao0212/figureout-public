"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Purchase {
  id: number;
  figure_id: number;
  figure_name: string;
  figure_image?: string;
  manufacturer?: string;
  price?: number;
  currency?: string;
  condition?: string;
  purchase_date?: string;
  notes?: string;
  user_report_id?: number;
  created_at?: string;
}

export interface PurchaseStats {
  total_count: number;
  by_currency: { currency: string; count: number; total: number }[];
}

interface PurchaseContextType {
  purchases: Purchase[];
  purchasedIds: Set<number>;
  isPurchased: (figureId: number) => boolean;
  refresh: () => Promise<void>;
  loading: boolean;
}

const PurchaseContext = createContext<PurchaseContextType | null>(null);

export function PurchaseProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      setPurchases([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/user/purchases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setPurchases(await r.json());
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => {
    // Fetch based on token alone — don't wait for user object.
    if (token) {
      refresh();
    } else {
      setPurchases([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const purchasedIds = new Set(purchases.map((p) => p.figure_id));
  const isPurchased = useCallback((figureId: number) => purchasedIds.has(figureId), [purchasedIds]);

  return (
    <PurchaseContext value={{ purchases, purchasedIds, isPurchased, refresh, loading }}>
      {children}
    </PurchaseContext>
  );
}

export function usePurchases(): PurchaseContextType {
  const ctx = useContext(PurchaseContext);
  if (!ctx) throw new Error("usePurchases must be used within <PurchaseProvider>");
  return ctx;
}
