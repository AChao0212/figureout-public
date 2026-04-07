"use client";

import FigureCard from "./FigureCard";

interface Figure {
  id: number;
  name: string;
  image_url?: string;
  manufacturer?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
}

export default function SearchResultsGrid({ figures, currency }: { figures: Figure[]; currency: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {figures.map((fig) => (
        <FigureCard
          key={fig.id}
          id={fig.id}
          name={fig.name}
          manufacturer={fig.manufacturer}
          image_url={fig.image_url}
          retail_price={fig.retail_price}
          retail_currency={fig.retail_currency}
          current_median_price={fig.current_median_price}
          price_change_pct={fig.price_change_pct}
          currency={currency}
        />
      ))}
    </div>
  );
}
