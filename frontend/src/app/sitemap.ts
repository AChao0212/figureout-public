import type { MetadataRoute } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const PAGE_SIZE = 100;

async function fetchAllFigureIds(): Promise<number[]> {
  const ids: number[] = [];
  try {
    // First request to get total count
    const firstRes = await fetch(`${API_URL}/figures?limit=${PAGE_SIZE}&skip=0`, {
      next: { revalidate: 86400 },
    });
    const firstData = await firstRes.json();
    const total: number = firstData.total || 0;
    const firstFigures = firstData.figures || [];
    for (const f of firstFigures) {
      ids.push(f.id);
    }

    // Fetch remaining pages in parallel
    const remaining = total - PAGE_SIZE;
    if (remaining > 0) {
      const pages = Math.ceil(remaining / PAGE_SIZE);
      const promises = Array.from({ length: pages }, (_, i) => {
        const skip = (i + 1) * PAGE_SIZE;
        return fetch(`${API_URL}/figures?limit=${PAGE_SIZE}&skip=${skip}`, {
          next: { revalidate: 86400 },
        }).then((r) => r.json());
      });
      const results = await Promise.all(promises);
      for (const data of results) {
        for (const f of data.figures || []) {
          ids.push(f.id);
        }
      }
    }
  } catch {
    // Return whatever we have
  }
  return ids;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: "https://figureout.tw", lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: "https://figureout.tw/trending", lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: "https://figureout.tw/browse", lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: "https://figureout.tw/search", lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: "https://figureout.tw/submit", lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  const figureIds = await fetchAllFigureIds();

  const figurePages: MetadataRoute.Sitemap = figureIds.map((id) => ({
    url: `https://figureout.tw/figures/${id}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [...staticPages, ...figurePages];
}
