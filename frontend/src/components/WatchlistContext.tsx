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

interface WatchlistContextType {
  watchlist: number[];
  addToWatchlist: (id: number) => void;
  removeFromWatchlist: (id: number) => void;
  isInWatchlist: (id: number) => boolean;
  clearWatchlist: () => Promise<void>;
  mergeToServer: () => Promise<void>;
  refreshFromServer: () => Promise<boolean>;
}

const WatchlistContext = createContext<WatchlistContextType | null>(null);

function loadLocal(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migrate from old format {id, type}[] to number[]
    return parsed
      .map((v) => (typeof v === "number" ? v : (v && typeof v.id === "number" ? v.id : null)))
      .filter((v): v is number => v !== null);
  } catch {
    return [];
  }
}

function saveLocal(items: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [watchlist, setWatchlist] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [serverMode, setServerMode] = useState(false);

  const refreshFromServer = useCallback(async () => {
    if (!token) return false;
    try {
      const r = await fetch(`${API_URL}/user/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const items: { id: number }[] = await r.json();
        setWatchlist(items.map((i) => i.id));
        setServerMode(true);
        return true;
      }
    } catch {}
    return false;
  }, [token]);

  useEffect(() => {
    // Fetch based on token alone — don't wait for user object.
    // The user object is only for display (username, role, count).
    if (token) {
      refreshFromServer().then((ok) => {
        if (!ok) {
          // Server request failed — fall back to local cache
          setWatchlist(loadLocal());
        }
        setHydrated(true);
      });
    } else {
      setWatchlist(loadLocal());
      setServerMode(false);
      setHydrated(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (hydrated && !serverMode) {
      saveLocal(watchlist);
    }
  }, [watchlist, hydrated, serverMode]);

  const apiCall = useCallback(
    async (method: string, path: string, body?: unknown) => {
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
    (id: number) => {
      setWatchlist((prev) => {
        if (prev.includes(id)) return prev;
        if (prev.length >= MAX_ITEMS) return prev;
        return [...prev, id];
      });
      if (serverMode) apiCall("POST", `/user/watchlist/${id}`, { type: "interested" });
    },
    [serverMode, apiCall],
  );

  const removeFromWatchlist = useCallback(
    (id: number) => {
      setWatchlist((prev) => prev.filter((v) => v !== id));
      if (serverMode) apiCall("DELETE", `/user/watchlist/${id}`);
    },
    [serverMode, apiCall],
  );

  const isInWatchlist = useCallback(
    (id: number) => watchlist.includes(id),
    [watchlist],
  );

  const clearWatchlist = useCallback(async () => {
    if (serverMode && watchlist.length > 0) {
      // Wait for all DELETEs to finish before clearing local state, so a quick
      // re-add after clear doesn't race the deletes.
      await Promise.all(
        watchlist.map((id) => {
          try {
            return apiCall("DELETE", `/user/watchlist/${id}`);
          } catch {
            return Promise.resolve();
          }
        }),
      );
    }
    setWatchlist([]);
  }, [serverMode, watchlist, apiCall]);

  const mergeToServer = useCallback(async () => {
    if (!token) return;
    const local = loadLocal();
    if (local.length === 0) return;
    try {
      await fetch(`${API_URL}/user/watchlist/merge`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items: local.map((id) => ({ id, type: "interested" })) }),
      });
      await refreshFromServer();
    } catch {}
  }, [token, refreshFromServer]);

  return (
    <WatchlistContext value={{ watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, clearWatchlist, mergeToServer, refreshFromServer }}>
      {children}
    </WatchlistContext>
  );
}

export function useWatchlist(): WatchlistContextType {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used within <WatchlistProvider>");
  return ctx;
}
