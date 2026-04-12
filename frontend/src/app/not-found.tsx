import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "找不到此頁面",
  description: "此頁面不存在或已被移除",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-6xl font-bold text-[#C4A265]">404</p>
      </div>
      <h1 className="mb-3 text-2xl font-bold text-[#e6edf3]">找不到此頁面</h1>
      <p className="mb-8 text-sm text-[#8b949e]">
        此頁面不存在或已被移除。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-[#C4A265] px-6 py-2.5 text-sm font-semibold text-[#0d1117] transition-colors hover:bg-[#B89255]"
        >
          回到首頁
        </Link>
        <Link
          href="/browse"
          className="rounded-lg border border-[#30363d] px-6 py-2.5 text-sm font-medium text-[#c9d1d9] transition-colors hover:border-[#C4A265]/50"
        >
          瀏覽公仔
        </Link>
      </div>
    </div>
  );
}
