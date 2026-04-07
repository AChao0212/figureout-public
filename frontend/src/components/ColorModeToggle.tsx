"use client";

import { useColorMode } from "./ColorModeContext";

export default function ColorModeToggle() {
  const { colorMode, toggleColorMode, upColor, downColor } = useColorMode();

  return (
    <button
      onClick={toggleColorMode}
      className="flex items-center gap-1 rounded-md border border-[#484f58] bg-[#21262d] px-2 py-1 text-[10px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:bg-[#30363d]"
      title={colorMode === "default" ? "綠漲紅跌 (點擊切換)" : "紅漲綠跌 (點擊切換)"}
    >
      <span className="text-sm font-bold" style={{ color: upColor }}>▲</span>
      <span className="text-sm font-bold" style={{ color: downColor }}>▼</span>
      <span className="text-[#c9d1d9]">漲跌色</span>
    </button>
  );
}
