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

const STORAGE_KEY = "figureout_watchlist";
const MAX_ITEMS = 100;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type WatchlistType = "interested" | "owned";

export interface WatchlistItem {
  id: number;
  type: WatchlistType;
}

interface WatchlistContextType {
  watchlist: WatchlistItem[];
  addToWatchlist: (id: number, type?: WatchlistType) => void;
  removeFromWatchlist: (id: number) => void;
  isInWatchlist: (id: number) => boolean;
  getWatchlistType: (id: number) => WatchlistType | null;
  setWatchlistType: (id: number, type: WatchlistType) => void;
  clearWatchlist: () => void;
  mergeToServer: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextType | null>(null);

function loadLocal(): WatchlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && typeof parsed[0] === "number") {
        return parsed.filter((v) => typeof v === "number").map((id) => ({ id, type: "interested" as WatchlistType }));
      }
      return parsed.filter((v) => v && typeof v.id === "number" && (v.type === "interested" || v.type === "owned"));
    }
  } catch {}
  return [];
}

function saveLocal(items: WatchlistItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [serverMode, setServerMode] = useState(false);

  // Hydrate: if logged in, fetch from server; else use localStorage
  useEffect(() => {
    if (token && user) {
      fetch(`${API_URL}/user/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((items: { id: number; type: string }[]) => {
          setWatchlist(items.map((i) => ({ id: i.id, type: (i.type === "owned" ? "owned" : "interested") as WatchlistType })));
          setServerMode(true);
          setHydrated(true);
        })
        .catch(() => {
          setWatchlist(loadLocal());
          setServerMode(false);
          setHydrated(true);
        });
    } else {
      setWatchlist(loadLocal());
      setServerMode(false);
      setHydrated(true);
    }
  }, [token, user]);

  // Persist localStorage when not in server mode
  useEffect(() => {
    if (hydrated && !serverMode) {
      saveLocal(watchlist);
    }
  }, [watchlist, hydrated, serverMode]);

  const apiCall = useCallback(
    async (method: string, path: string, body?: any) => {
      if (!token) return;
      try {
        await fetch(`${API_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {}
    },
    [token],
  );

  const addToWatchlist = useCallback(
    (id: number, type: WatchlistType = "interested") => {
      setWatchlist((prev) => {
        if (prev.some((item) => item.id === id)) return prev;
        if (prev.length >= MAX_ITEMS) return prev;
        return [...prev, { id, type }];
      });
      if (serverMode) apiCall("POST", `/user/watchlist/${id}`, { type });
    },
    [serverMode, apiCall],
  );

  const removeFromWatchlist = useCallback(
    (id: number) => {
      setWatchlist((prev) => prev.filter((item) => item.id !== id));
      if (serverMode) apiCall("DELETE", `/user/watchlist/${id}`);
    },
    [serverMode, apiCall],
  );

  const isInWatchlist = useCallback(
    (id: number) => watchlist.some((item) => item.id === id),
    [watchlist],
  );

  const getWatchlistType = useCallback(
    (id: number): WatchlistType | null => {
      const item = watchlist.find((item) => item.id === id);
      return item ? item.type : null;
    },
    [watchlist],
  );

  const setWatchlistType = useCallback(
    (id: number, type: WatchlistType) => {
      setWatchlist((prev) =>
        prev.map((item) => (item.id === id ? { ...item, type } : item)),
      );
      if (serverMode) apiCall("PATCH", `/user/watchlist/${id}`, { type });
    },
    [serverMode, apiCall],
  );

  const clearWatchlist = useCallback(() => {
    // Delete all from server
    if (serverMode) {
      watchlist.forEach((item) => apiCall("DELETE", `/user/watchlist/${item.id}`));
    }
    setWatchlist([]);
  }, [serverMode, watchlist, apiCall]);

  const mergeToServer = useCallback(async () => {
    if (!token) return;
    const localItems = loadLocal();
    if (localItems.length === 0) return;
    try {
      await fetch(`${API_URL}/user/watchlist/merge`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items: localItems }),
      });
      // Refresh from server
      const r = await fetch(`${API_URL}/user/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const items = await r.json();
        setWatchlist(items.map((i: any) => ({ id: i.id, type: (i.type === "owned" ? "owned" : "interested") as WatchlistType })));
        setServerMode(true);
      }
    } catch {}
  }, [token]);

  return (
    <WatchlistContext value={{ watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, getWatchlistType, setWatchlistType, clearWatchlist, mergeToServer }}>
      {children}
    </WatchlistContext>
  );
}

export function useWatchlist(): WatchlistContextType {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used within <WatchlistProvider>");
  return ctx;
}
