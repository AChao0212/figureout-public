"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type ColorMode = "default" | "reversed";

interface ColorModeContextType {
  colorMode: ColorMode;
  toggleColorMode: () => void;
  upColor: string;
  downColor: string;
}

const ColorModeContext = createContext<ColorModeContextType>({
  colorMode: "default",
  toggleColorMode: () => {},
  upColor: "#f85149",
  downColor: "#3fb950",
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

  const toggleColorMode = () => {
    const next = colorMode === "default" ? "reversed" : "default";
    setColorMode(next);
    localStorage.setItem("figureout_color_mode", next);
  };

  const upColor = colorMode === "default" ? "#f85149" : "#3fb950";
  const downColor = colorMode === "default" ? "#3fb950" : "#f85149";

  return (
    <ColorModeContext.Provider value={{ colorMode, toggleColorMode, upColor, downColor }}>
      {children}
    </ColorModeContext.Provider>
  );
}
