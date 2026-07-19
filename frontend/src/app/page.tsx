import SearchBar from "@/components/SearchBar";
import Link from "next/link";
import PageTracker from "@/components/PageTracker";
import ParticleBackground from "@/components/ParticleBackground";
import FadeInSection from "@/components/FadeInSection";
import FeaturedGrid from "@/components/FeaturedGrid";
import StatsBar from "@/components/StatsBar";

interface FigureOut {
  id: number;
  name: string;
  manufacturer?: string;
  scale?: string;
  image_url?: string;
  retail_price?: number;
  original_name?: string;
  franchise_name?: string;
  current_median_price?: number;
  price_change_pct?: number;
}

interface FranchiseOut {
  id: number;
  name: string;
}

async function getFeatured(): Promise<FigureOut[]> {
  // Server-side: prefer internal URL (http://api:8000) to avoid going out
  // through Cloudflare (which can ETIMEDOUT from inside the container).
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/browse/featured?limit=12`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getPopularFranchises(): Promise<FranchiseOut[]> {
  // Server-side: prefer internal URL (http://api:8000) to avoid going out
  // through Cloudflare (which can ETIMEDOUT from inside the container).
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/browse/popular-franchises?limit=12`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const { currency = "TWD" } = await searchParams;
  const [featured, popularFranchises] = await Promise.all([
    getFeatured(),
    getPopularFranchises(),
  ]);

  return (
    <div className="flex flex-1 flex-col px-4 py-6 sm:py-12">
      <PageTracker page="/" />
      <ParticleBackground />
      {/* Hero */}
      <FadeInSection>
      <div className="mx-auto w-full max-w-xl space-y-5 text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-[#e6edf3] sm:text-4xl">
            PVC 公仔<span className="text-[#C4A265]">二級市場</span>行情平台
          </h1>
          <p className="text-sm text-[#8b949e]">
            追蹤二手成交價格，掌握市場真實行情。
          </p>
        </div>
        <SearchBar large />
      </div>
      </FadeInSection>

      {/* Featured Figures */}
      {featured.length > 0 && (
        <FadeInSection delay={200}>
        <section className="mx-auto mt-8 w-full max-w-5xl">
          <h2 className="mb-3 text-sm font-semibold text-[#c9d1d9]">熱門公仔</h2>
          <FeaturedGrid figures={featured} currency={currency} />
        </section>
        </FadeInSection>
      )}

      {/* Popular Franchises */}
      {popularFranchises.length > 0 && (
        <FadeInSection delay={100}>
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#c9d1d9]">熱門作品</h2>
            <Link href="/browse" className="text-xs text-[#6e7681] hover:text-[#C4A265]">
              查看全部 →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {popularFranchises.map((f) => (
              <Link
                key={f.id}
                href={`/browse/${f.id}`}
                className="rounded-full border border-[#30363d] bg-[#161b22] px-3.5 py-1.5 text-xs text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
              >
                {f.name}
              </Link>
            ))}
          </div>
        </section>
        </FadeInSection>
      )}

      {/* Stats Dashboard */}
      <FadeInSection delay={200}>
        <StatsBar />
      </FadeInSection>

      {/* Links: Chrome Extension & GitHub */}
      <FadeInSection delay={300}>
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://chromewebstore.google.com/detail/figureout-price-reporter/bbeeniochakeccockgedlbgehmhhoknb"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2.5 text-sm text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001-3.952 6.848c.404.037.812.058 1.227.058 6.627 0 12-5.373 12-12 0-1.006-.127-1.983-.364-2.917H15.31zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
              </svg>
              Chrome 擴充功能
            </a>
            <a
              href="https://github.com/AChao0212/figureout-public"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2.5 text-sm text-[#8b949e] transition-colors hover:border-[#C4A265] hover:text-[#C4A265]"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
          </div>
        </section>
      </FadeInSection>
    </div>
  );
}
