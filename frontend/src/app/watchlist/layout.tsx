import type { Metadata } from "next";

// Per-user content (auth-gated, dynamic per visitor). Emit noindex via a server
// component layout so Googlebot can crawl + see it (paired with robots.txt
// allowing /watchlist so the meta tag is actually visible).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
