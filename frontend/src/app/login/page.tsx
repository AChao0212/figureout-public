"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { useWatchlist } from "@/components/WatchlistContext";

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register, token } = useAuth();
  const { mergeToServer } = useWatchlist();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "login") {
        await login(username, password);
      } else {
        await register(username, password, displayName || undefined);
      }
      // Merge localStorage watchlist to server after login/register
      await mergeToServer();
      router.push("/");
    } catch (err: any) {
      setError(err.message || "操作失敗");
    }
    setLoading(false);
  };

  return (
    <div className="col-narrow pb-16 pt-[clamp(40px,8vh,90px)]">
      {/* No card: the form stands on the page, and each field is a ruled line
          rather than a box, matching every other input on the site. */}
      <h1 className="display mb-[clamp(26px,4vh,42px)]">
        {tab === "login" ? "登入" : "註冊"}
      </h1>

      <div className="rule-b flex gap-x-8 pb-4">
        <button
          type="button"
          onClick={() => {
            setTab("login");
            setError("");
          }}
          aria-pressed={tab === "login"}
          className="seg"
        >
          登入
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("register");
            setError("");
          }}
          aria-pressed={tab === "register"}
          className="seg"
        >
          註冊
        </button>
      </div>

      {error && (
        <p className="pt-5 text-[13px] text-[var(--hue-red)]">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-7 pt-8">
        <div>
          <label className="lbl" htmlFor="lg-user">
            帳號
          </label>
          <div className="field">
            <input
              id="lg-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="英文、數字或底線，3-30 字元"
              required
              autoComplete="username"
            />
          </div>
        </div>

        <div>
          <label className="lbl" htmlFor="lg-pass">
            密碼
          </label>
          <div className="field">
            <input
              id="lg-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 個字元"
              required
              autoComplete={tab === "login" ? "current-password" : "new-password"}
            />
          </div>
        </div>

        {tab === "register" && (
          <div>
            <label className="lbl" htmlFor="lg-name">
              顯示名稱（選填）
            </label>
            <div className="field">
              <input
                id="lg-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="不填則使用帳號名稱"
                autoComplete="name"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full bg-[var(--ink)] py-3 text-[14px] font-medium text-[var(--ground)] transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {loading ? "處理中…" : tab === "login" ? "登入" : "註冊"}
        </button>
      </form>
    </div>
  );
}
