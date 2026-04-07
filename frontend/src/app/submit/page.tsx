"use client";

import { useState, useEffect, useRef } from "react";

const SCALE_OPTIONS = ["1/1", "1/3", "1/4", "1/5", "1/6", "1/7", "1/8", "1/9", "1/10", "1/12"];
const MATERIAL_OPTIONS = ["PVC、ABS", "PVC", "ABS", "塑料", "樹脂", "ATBC-PVC、ABS"];
const FIGURE_TYPE_OPTIONS = ["比例人形", "GK", "Q版人形"];
const AGE_RATING_OPTIONS = ["全年齡", "R18"];

interface Suggestion {
  name: string;
  franchise?: string;
}

function AutocompleteInput({
  label,
  value,
  onChange,
  placeholder,
  endpoint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  endpoint: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const inputClass =
    "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-gray-500 outline-none focus:border-[#C4A265] focus:ring-1 focus:ring-[#C4A265] transition-colors";

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = (q: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (q.length < 1) { setSuggestions([]); return; }
    timeoutRef.current = setTimeout(async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiUrl}/browse/autocomplete/${endpoint}?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          setSuggestions(await res.json());
          setShowSuggestions(true);
        }
      } catch {}
    }, 300);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">{label.endsWith(" *") ? <>{label.slice(0, -2)} <span className="text-[#C4A265]">*</span></> : label}</label>
      <input type="text" placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); fetchSuggestions(e.target.value); }}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        className={inputClass} />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#30363d] bg-[#161b22] py-1 shadow-lg">
          {suggestions.map((s, i) => (
            <button key={i} type="button"
              onClick={() => { onChange(s.name); setShowSuggestions(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#c9d1d9] hover:bg-[#0d1117]">
              <span>{s.name}</span>
              {s.franchise && <span className="text-[10px] text-[#6e7681]">({s.franchise})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SubmitFigurePage() {
  const [form, setForm] = useState({
    name: "", original_name: "", character_name: "", franchise_name: "",
    manufacturer: "", series: "", scale: "", jan_code: "",
    image_url: "", notes: "", retail_price: "",
    figure_type: "", age_rating: "", material: "",
    sculptor: "", painter: "", dimensions: "", release_date: "",
  });
  const [retailCurrency, setRetailCurrency] = useState<"JPY" | "CNY">("JPY");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields
    const missing: string[] = [];
    if (!form.original_name.trim()) missing.push("原名");
    if (!form.character_name.trim()) missing.push("角色名稱");
    if (!form.franchise_name.trim()) missing.push("作品/IP");
    if (!form.manufacturer.trim()) missing.push("製造商");
    if (!form.scale) missing.push("比例");
    if (!form.figure_type) missing.push("類型");
    if (!form.material) missing.push("材質");
    if (!form.age_rating) missing.push("分級");
    if (!form.retail_price) missing.push("定價");
    if (!form.image_url.trim()) missing.push("圖片網址");
    if (missing.length > 0) {
      alert("請填寫必填欄位：" + missing.join("、"));
      return;
    }
    setStatus("submitting");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    try {
      const res = await fetch(`${apiUrl}/figures/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          retail_price: form.retail_price ? parseInt(form.retail_price) : null,
          retail_currency: retailCurrency,
        }),
      });
      if (res.ok) {
        setStatus("success");
        setForm({ name: "", original_name: "", character_name: "", franchise_name: "", manufacturer: "", series: "", scale: "", jan_code: "", image_url: "", notes: "", retail_price: "", figure_type: "", age_rating: "", material: "", sculptor: "", painter: "", dimensions: "", release_date: "" });
        setRetailCurrency("JPY");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  const inputClass =
    "w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-gray-500 outline-none focus:border-[#C4A265] focus:ring-1 focus:ring-[#C4A265] transition-colors [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]";

  const TagSelector = ({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">{label.endsWith(" *") ? <>{label.slice(0, -2)} <span className="text-[#C4A265]">*</span></> : label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt} type="button"
            onClick={() => onChange(value === opt ? "" : opt)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              value === opt
                ? "border-[#C4A265] bg-[#C4A265]/20 text-[#C4A265]"
                : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#484f58] hover:text-[#c9d1d9]"
            }`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-lg px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-1 text-xl font-bold text-[#e6edf3] sm:text-2xl">提交新公仔</h1>
      <p className="mb-6 text-sm text-[#8b949e]">
        找不到你的公仔？填寫以下資料提交，審核通過後將加入資料庫。
      </p>

      {status === "success" ? (
        <div className="rounded-lg border border-green-800 bg-green-900/30 p-6 text-center">
          <p className="font-semibold text-green-400">提交成功！</p>
          <p className="mt-1 text-sm text-[#8b949e]">感謝你的貢獻，我們會盡快審核。</p>
          <button onClick={() => setStatus("idle")}
            className="mt-3 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-1.5 text-sm text-[#8b949e] hover:bg-[#0d1117]">
            繼續提交
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">基本資料</h2>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">
                公仔全名 <span className="text-[#C4A265]">*</span>
              </label>
              <input type="text" required placeholder="例：初音未來 feat. 米山舞 1/7"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">原名 / 官方名稱 <span className="text-[#C4A265]">*</span></label>
              <input type="text" required placeholder="日文/中文/英文原名皆可"
                value={form.original_name} onChange={(e) => setForm({ ...form, original_name: e.target.value })}
                className={inputClass} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AutocompleteInput label="角色名稱 *" value={form.character_name}
                onChange={(v) => setForm({ ...form, character_name: v })}
                placeholder="例：鷯（大鳳）" endpoint="characters" />
              <AutocompleteInput label="作品/IP *" value={form.franchise_name}
                onChange={(v) => setForm({ ...form, franchise_name: v })}
                placeholder="例：碧藍航線" endpoint="franchises" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AutocompleteInput label="製造商 *" value={form.manufacturer}
                onChange={(v) => setForm({ ...form, manufacturer: v })}
                placeholder="例：Good Smile Company" endpoint="manufacturers" />
              <AutocompleteInput label="系列" value={form.series}
                onChange={(v) => setForm({ ...form, series: v })}
                placeholder="例：POP UP PARADE" endpoint="series" />
            </div>

          </div>

          {/* Classification */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">分類</h2>
            <TagSelector label="比例 *" options={SCALE_OPTIONS}
              value={form.scale} onChange={(v) => setForm({ ...form, scale: v })} />
            <TagSelector label="類型 *" options={FIGURE_TYPE_OPTIONS}
              value={form.figure_type} onChange={(v) => setForm({ ...form, figure_type: v })} />
            <TagSelector label="材質 *" options={MATERIAL_OPTIONS}
              value={form.material} onChange={(v) => setForm({ ...form, material: v })} />
            <TagSelector label="分級 *" options={AGE_RATING_OPTIONS}
              value={form.age_rating} onChange={(v) => setForm({ ...form, age_rating: v })} />
          </div>

          {/* Production */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">製作資訊</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AutocompleteInput label="原型師" value={form.sculptor}
                onChange={(v) => setForm({ ...form, sculptor: v })}
                placeholder="例：VANE" endpoint="sculptors" />
              <AutocompleteInput label="塗裝" value={form.painter}
                onChange={(v) => setForm({ ...form, painter: v })}
                placeholder="例：奶牛" endpoint="painters" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">尺寸</label>
                <input type="text" placeholder="例：H=250mm"
                  value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })}
                  className={inputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">發售日期</label>
                <input type="text" placeholder="例：2026/03"
                  value={form.release_date} onChange={(e) => setForm({ ...form, release_date: e.target.value })}
                  className={inputClass} />
              </div>
            </div>
          </div>

          {/* Price & Identity */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">價格 & 識別碼</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">定價 <span className="text-[#C4A265]">*</span></label>
                <div className="flex gap-2">
                  <input type="number" required placeholder={retailCurrency === "JPY" ? "例：16800" : "例：820"}
                    value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value })}
                    className={inputClass + " flex-1"} />
                  <div className="flex shrink-0 rounded-lg border border-[#30363d] bg-[#161b22] p-0.5">
                    <button type="button"
                      onClick={() => setRetailCurrency("JPY")}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        retailCurrency === "JPY"
                          ? "bg-[#C4A265]/20 text-[#C4A265]"
                          : "text-[#8b949e] hover:text-[#c9d1d9]"
                      }`}>
                      JPY
                    </button>
                    <button type="button"
                      onClick={() => setRetailCurrency("CNY")}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        retailCurrency === "CNY"
                          ? "bg-[#C4A265]/20 text-[#C4A265]"
                          : "text-[#8b949e] hover:text-[#c9d1d9]"
                      }`}>
                      CNY
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">JAN Code</label>
                <input type="text" placeholder="選填"
                  value={form.jan_code} onChange={(e) => setForm({ ...form, jan_code: e.target.value })}
                  className={inputClass} />
              </div>
            </div>
            <p className="text-[10px] text-[#484f58]">
              僅收錄定價約 NT$1,000 以上的公仔（日幣 ¥3,700 / 人民幣 ¥180 以上）
            </p>
          </div>

          {/* Image & Notes */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">其他</h2>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">圖片網址 <span className="text-[#C4A265]">*</span></label>
              <input type="url" required placeholder="https://..."
                value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#c9d1d9]">備註</label>
              <textarea placeholder="其他補充資訊"
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2} className={inputClass} />
            </div>
          </div>

          {status === "error" && (
            <p className="text-xs text-red-400">提交失敗，請稍後再試。</p>
          )}

          <button type="submit" disabled={status === "submitting"}
            className="w-full rounded-lg bg-[#C4A265] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#B89255] disabled:opacity-50">
            {status === "submitting" ? "提交中..." : "提交公仔"}
          </button>
        </form>
      )}
    </div>
  );
}
