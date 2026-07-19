"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "figureout_token";

export type User = {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  report_count: number;
};

type AuthContextValue = {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

class AuthError extends Error {
  constructor(public status: number) {
    super(`Auth failed: ${status}`);
  }
}

async function fetchProfile(token: string): Promise<User> {
  const res = await fetch(`${API_URL}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(res.status);
    }
    throw new Error(`Failed to fetch profile: ${res.status}`);
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);

    // Try to fetch profile with retry. Only clear token if ALL retries
    // return auth errors (401/403) — that means the token is truly invalid.
    // Network errors / 5xx errors keep the token for next retry.
    const tryFetch = async (): Promise<void> => {
      let allAuthErrors = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const profile = await fetchProfile(stored);
          setUser(profile);
          return;
        } catch (err) {
          if (!(err instanceof AuthError)) {
            allAuthErrors = false;
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          }
        }
      }
      // All 3 attempts failed
      if (allAuthErrors) {
        // Token is truly invalid (consistently 401/403)
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      }
      // else: transient errors, keep token for recovery
    };

    tryFetch().finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "登入失敗");
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    // Fetch full profile (with report_count). Don't throw if this fails —
    // login already succeeded, profile can be fetched later.
    try {
      const profile = await fetchProfile(data.token);
      setUser(profile);
    } catch {
      // Login succeeded but profile fetch failed — leave user null,
      // next page load or refreshUser() call will retry.
    }
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    const res = await fetch(`${API_URL}/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, display_name: displayName || undefined }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "註冊失敗");
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    try {
      const profile = await fetchProfile(data.token);
      setUser(profile);
    } catch {
      // Same — register succeeded, profile fetch will retry
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Track how many consecutive refresh failures we've had so components
  // polling refreshUser() don't trigger an infinite retry loop when the
  // backend is returning 500 / unreachable.
  const refreshFailuresRef = useRef(0);
  const refreshUser = useCallback(async () => {
    if (!token) return;
    if (refreshFailuresRef.current >= 3) return;
    try {
      const profile = await fetchProfile(token);
      setUser(profile);
      refreshFailuresRef.current = 0;
    } catch (err: any) {
      // AuthError → token bad; logout() was already handled elsewhere.
      // For transient errors, bump the counter and stop retrying after 3.
      refreshFailuresRef.current += 1;
    }
  }, [token]);

  return (
    <AuthContext value={{ user, token, login, register, logout, refreshUser, loading }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
