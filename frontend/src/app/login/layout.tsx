import type { Metadata } from "next";

// Auth form — no SEO value, must not be indexed. Emit noindex via a server
// component layout (the page itself is "use client" so can't export metadata
// directly).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
