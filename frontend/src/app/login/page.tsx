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

  const inp = "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-[#484f58] focus:border-[#C4A265] focus:outline-none";

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-6">
        <h1 className="mb-6 text-center text-xl font-bold text-[#e6edf3]">
          {tab === "login" ? "登入" : "註冊"}
        </h1>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg border border-[#30363d] bg-[#161b22] p-1">
          <button
            onClick={() => { setTab("login"); setError(""); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              tab === "login" ? "bg-[#0d1117] text-[#C4A265]" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            登入
          </button>
          <button
            onClick={() => { setTab("register"); setError(""); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              tab === "register" ? "bg-[#0d1117] text-[#C4A265]" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            註冊
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-[#f85149]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-[#6e7681]">帳號</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="英文、數字或底線，3-30 字元"
              className={inp}
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#6e7681]">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 個字元"
              className={inp}
              required
              autoComplete={tab === "login" ? "current-password" : "new-password"}
            />
          </div>
          {tab === "register" && (
            <div>
              <label className="mb-1 block text-xs text-[#6e7681]">顯示名稱（選填）</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="不填則使用帳號名稱"
                className={inp}
                autoComplete="name"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#C4A265] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B89255] disabled:opacity-50"
          >
            {loading ? "處理中..." : tab === "login" ? "登入" : "註冊"}
          </button>
        </form>
      </div>
    </div>
  );
}
