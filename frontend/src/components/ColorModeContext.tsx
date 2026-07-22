"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

/**
 * Gain/loss colour convention — NOT a light/dark theme.
 *
 *   default  →  紅漲綠跌 (Taiwan / Asia markets)
 *   reversed →  green-up (Western markets)
 *
 * The provider mirrors the choice onto <html data-color-mode>, so plain CSS
 * can resolve --up / --down (see globals.css) without every component
 * threading colours through props. The context values are kept for callers
 * that need the raw hex (SVG fills, canvas, inline styles).
 */
type ColorMode = "default" | "reversed";

/* Same desaturated, warm-leaning pair the rest of the shell uses. The old
 * #f85149 / #3fb950 were near-neon and fought the product photography. */
const RED = "#c97766";
const GREEN = "#7cb088";

interface ColorModeContextType {
  colorMode: ColorMode;
  toggleColorMode: () => void;
  upColor: string;
  downColor: string;
}

const ColorModeContext = createContext<ColorModeContextType>({
  colorMode: "default",
  toggleColorMode: () => {},
  upColor: RED,
  downColor: GREEN,
});

export function useColorMode() {
  return useContext(ColorModeContext);
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setColorMode] = useState<ColorMode>("default");

  useEffect(() => {
    const saved = localStorage.getItem("figureout_color_mode");
    if (saved === "reversed") setColorMode("reversed");
  }, []);

  // Keep the DOM attribute in step with state, including the initial
  // localStorage read above.
  useEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
  }, [colorMode]);

  const toggleColorMode = () => {
    const next = colorMode === "default" ? "reversed" : "default";
    setColorMode(next);
    localStorage.setItem("figureout_color_mode", next);
  };

  const upColor = colorMode === "default" ? RED : GREEN;
  const downColor = colorMode === "default" ? GREEN : RED;

  return (
    <ColorModeContext.Provider value={{ colorMode, toggleColorMode, upColor, downColor }}>
      {children}
    </ColorModeContext.Provider>
  );
}
