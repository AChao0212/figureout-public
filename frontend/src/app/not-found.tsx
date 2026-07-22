import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
 title: "找不到此頁面",
 description: "此頁面不存在或已被移除",
 robots: { index: false, follow: false },
};

export default function NotFound() {
 return (
    <div className="col-narrow py-24 text-center">
      <div className="mb-6">
        <p className="text-6xl font-medium text-[var(--ink)]">404</p>
      </div>
      <h1 className="mb-3 text-2xl font-medium text-[var(--ink)]">找不到此頁面</h1>
      <p className="mb-8 text-sm text-[var(--ink-2)]">
        此頁面不存在或已被移除。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
 href="/"
 className="bg-[var(--ink)] px-6 py-2.5 text-sm font-medium text-[var(--ground)] transition-colors hover:bg-[var(--ink-2)]"
        >
          回到首頁
        </Link>
        <Link
 href="/browse"
 className="border border-[var(--rule)] px-6 py-2.5 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]/50"
        >
          瀏覽公仔
        </Link>
      </div>
    </div>
  );
}
