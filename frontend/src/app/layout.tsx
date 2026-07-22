import type { Metadata } from "next";
import "./globals.css";

import { ColorModeProvider } from "@/components/ColorModeContext";
import { WatchlistProvider } from "@/components/WatchlistContext";
import { PurchaseProvider } from "@/components/PurchaseContext";
import { ExchangeRateProvider } from "@/components/ExchangeRateContext";
import { AuthProvider } from "@/components/AuthContext";
import SiteChrome from "@/components/SiteChrome";

export const metadata: Metadata = {
  metadataBase: new URL("https://figureout.tw"),
  title: {
    default: "FigureOut — PVC 公仔二級市場行情平台",
    template: "%s | FigureOut",
  },
  description:
    "PVC 公仔二級市場價格透明化平台 — 整合真實成交數據，掌握市場行情。",
  openGraph: {
    type: "website",
    locale: "zh_TW",
    url: "https://figureout.tw",
    siteName: "FigureOut",
    title: "FigureOut — PVC 公仔二級市場行情平台",
    description:
      "PVC 公仔二級市場價格透明化平台 — 整合真實成交數據，掌握市場行情。",
  },
  twitter: {
    card: "summary_large_image",
    title: "FigureOut — PVC 公仔二級市場行情平台",
    description:
      "PVC 公仔二級市場價格透明化平台 — 整合真實成交數據，掌握市場行情。",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW" className="h-full">
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <ColorModeProvider>
          <AuthProvider>
            <ExchangeRateProvider>
              <WatchlistProvider>
                <PurchaseProvider>
                  <SiteChrome />

                  {/* The bar is fixed, so everything in normal flow starts
                      below it — the notice included, or it would sit under
                      the bar and be unreadable. */}
                  {/* Remount <SiteNotice /> above <main> to run a site-wide
                      banner; the hpoi CDN outage it was written for is over. */}
                  <div className="flex flex-1 flex-col pt-[var(--bar)]">
                    <main className="flex-1">{children}</main>
                  </div>

                  <footer className="col rule mt-[clamp(46px,8vh,92px)] flex flex-wrap justify-between gap-4 pb-14 pt-5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span>FigureOut · PVC 公仔二級市場報價工具</span>
                    <a href="/privacy" className="transition-colors hover:text-[var(--ink)]">隱私權政策</a>
                  </footer>
                </PurchaseProvider>
              </WatchlistProvider>
            </ExchangeRateProvider>
          </AuthProvider>
        </ColorModeProvider>
      </body>
    </html>
  );
}
