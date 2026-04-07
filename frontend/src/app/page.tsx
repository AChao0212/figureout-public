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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
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
    </div>
  );
}
