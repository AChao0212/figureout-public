import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import CurrencySelector from "@/components/CurrencySelector";
import ColorModeToggle from "@/components/ColorModeToggle";
import { ColorModeProvider } from "@/components/ColorModeContext";
import { WatchlistProvider } from "@/components/WatchlistContext";
import { ExchangeRateProvider } from "@/components/ExchangeRateContext";
import { AuthProvider } from "@/components/AuthContext";
import UserMenu from "@/components/UserMenu";
import MobileNav from "@/components/MobileNav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

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
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col overflow-x-hidden bg-[#0d1117] text-[#e6edf3]">
        <ColorModeProvider>
        <AuthProvider>
        <ExchangeRateProvider><WatchlistProvider>
        <header className="sticky top-0 z-50 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl font-bold text-[#C4A265]">
                  FigureOut
                </span>
              </Link>

              {/* Desktop nav */}
              <nav className="hidden items-center gap-4 text-sm text-[#8b949e] sm:flex">
                <Link href="/" className="transition-colors hover:text-[#e6edf3]">首頁</Link>
                <Link href="/browse" className="transition-colors hover:text-[#e6edf3]">瀏覽</Link>
                <Link href="/trending" className="transition-colors hover:text-[#e6edf3]">排行榜</Link>
                <Link href="/watchlist" className="transition-colors hover:text-[#e6edf3]">收藏</Link>
                <Link href="/submit" className="transition-colors hover:text-[#e6edf3]">提交公仔</Link>
                <UserMenu />
              </nav>

              {/* Mobile nav */}
              <div className="sm:hidden">
                <MobileNav />
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-10 flex-1">{children}</main>

        <footer className="relative z-10 border-t border-[#30363d] py-6">
          <div className="mx-auto max-w-7xl px-4 text-center text-xs text-[#8b949e]">
            FigureOut — PVC 公仔二級市場行情平台
          </div>
        </footer>
        </WatchlistProvider></ExchangeRateProvider>
        </AuthProvider>
        </ColorModeProvider>
      </body>
    </html>
  );
}
