import type { MetadataRoute } from "next";

// Force dynamic — sitemap must fetch from API at runtime, not at build time
export const dynamic = "force-dynamic";
export const revalidate = 86400; // ISR: regenerate at most once per day

const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchFigureIdsWithListings(): Promise<number[]> {
  try {
    const res = await fetch(`${API_URL}/figures/sitemap-ids`, {
      next: { revalidate: 86400 },
    });
    const data = await res.json();
    return data.ids || [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: "https://figureout.tw", lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: "https://figureout.tw/trending", lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: "https://figureout.tw/browse", lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: "https://figureout.tw/submit", lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  // Only include figures that have actual listing/price data.
  // This reduces sitemap from ~37K to ~1.7K entries, boosting crawl efficiency.
  const figureIds = await fetchFigureIdsWithListings();

  const figurePages: MetadataRoute.Sitemap = figureIds.map((id) => ({
    url: `https://figureout.tw/figures/${id}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...figurePages];
}
