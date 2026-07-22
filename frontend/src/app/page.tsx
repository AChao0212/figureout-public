import SearchBar from "@/components/SearchBar";
import Link from "next/link";
import PageTracker from "@/components/PageTracker";
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

/**
 * The entrance is the tool, not a pitch: search, then the figures themselves.
 * No headline claim — "38,944 件" further down argues the case better than a
 * sentence would.
 */
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
    <div className="col pb-6 pt-[clamp(24px,4.5vh,46px)]">
      <PageTracker page="/" />

      <FadeInSection>
        <SearchBar large />
      </FadeInSection>

      {featured.length > 0 && (
        <FadeInSection delay={100}>
          <section className="pt-[clamp(26px,4.5vh,46px)]">
            <div className="flex flex-wrap items-baseline justify-between gap-4 pb-[clamp(15px,2.4vh,22px)]">
              <h2 className="sec-title">熱門公仔</h2>
              <Link
                href="/trending"
                className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              >
                排行榜 ↗
              </Link>
            </div>
            <FeaturedGrid figures={featured} currency={currency} />
          </section>
        </FadeInSection>
      )}

      {popularFranchises.length > 0 && (
        <FadeInSection delay={150}>
          <section className="pt-[clamp(32px,5vh,54px)]">
            <div className="flex flex-wrap items-baseline justify-between gap-4 pb-[clamp(15px,2.4vh,22px)]">
              <h2 className="sec-title">熱門作品</h2>
              <Link
                href="/browse"
                className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
              >
                瀏覽全部 ↗
              </Link>
            </div>
            <div className="rule flex flex-wrap gap-x-8 gap-y-3 pt-5">
              {popularFranchises.map((f) => (
                <Link
                  key={f.id}
                  href={`/browse/${f.id}`}
                  className="text-[14px] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
                >
                  {f.name}
                </Link>
              ))}
            </div>
          </section>
        </FadeInSection>
      )}

      <FadeInSection delay={200}>
        <section className="pt-[clamp(32px,5vh,54px)]">
          <StatsBar />
        </section>
      </FadeInSection>

      <FadeInSection delay={250}>
        <section className="rule mt-[clamp(32px,5vh,54px)] flex flex-wrap gap-x-8 gap-y-3 pt-5">
          <a
            href="https://chromewebstore.google.com/detail/figureout-price-reporter/bbeeniochakeccockgedlbgehmhhoknb"
            target="_blank"
            rel="noopener noreferrer"
            className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            Chrome 擴充功能 ↗
          </a>
          <a
            href="https://github.com/AChao0212/figureout-public"
            target="_blank"
            rel="noopener noreferrer"
            className="mono-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            GitHub ↗
          </a>
        </section>
      </FadeInSection>
    </div>
  );
}
