"use client";

import FigureCard from "./FigureCard";

interface FigureOut {
  id: number;
  name: string;
  manufacturer?: string;
  image_url?: string;
  retail_price?: number;
  retail_currency?: string;
  current_median_price?: number;
  price_change_pct?: number;
}

export default function FeaturedGrid({ figures, currency }: { figures: FigureOut[]; currency: string }) {
  return (
    <div className="wall">
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
