"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SearchBarProps {
  defaultValue?: string;
  large?: boolean;
}

export default function SearchBar({
  defaultValue = "",
  large = false,
}: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute left-3 text-[#6e7681]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={large ? "h-5 w-5" : "h-4 w-4"}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋公仔名稱、角色、系列或製造商..."
          className={`w-full rounded-l-lg border border-[#30363d] bg-[#161b22] text-[#e6edf3] placeholder-gray-400 focus:border-[#C4A265] focus:outline-none focus:ring-1 focus:ring-[#C4A265] ${
            large ? "py-3 pl-10 pr-3 text-base" : "py-2 pl-9 pr-3 text-sm"
          }`}
        />
        <button
          type="submit"
          className={`whitespace-nowrap rounded-r-lg bg-[#C4A265] font-medium text-white transition-colors hover:bg-[#B89255] ${
            large ? "border border-[#C4A265] px-5 py-3 text-sm" : "border border-[#C4A265] px-4 py-2 text-sm"
          }`}
        >
          搜尋
        </button>
      </div>
    </form>
  );
}
