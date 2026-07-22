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
 className="border border-[var(--rule)] bg-[var(--ground-lift)] px-2.5 py-1 text-xs text-[var(--ink-2)] outline-none focus:border-[var(--ink)] cursor-pointer"
    >
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
