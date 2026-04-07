"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const CURRENCIES = [
  { code: "TWD", label: "TWD" },
  { code: "USD", label: "USD" },
  { code: "JPY", label: "JPY" },
  { code: "CNY", label: "CNY" },
];

export default function CurrencySelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("currency") || "TWD";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("currency", e.target.value);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      value={current}
      onChange={handleChange}
      className="rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-[#8b949e] outline-none focus:border-[#C4A265] cursor-pointer"
    >
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
