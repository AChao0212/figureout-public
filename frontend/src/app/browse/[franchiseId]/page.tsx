import Link from "next/link";

interface Franchise {
  id: number;
  name: string;
  name_zh?: string;
}

interface Character {
  id: number;
  name: string;
  name_zh?: string;
  franchise?: Franchise;
}

async function getCharacters(franchiseId: string): Promise<Character[]> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(
      `${apiUrl}/browse/franchises/${franchiseId}/characters`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default async function FranchiseCharactersPage({
  params,
}: {
  params: Promise<{ franchiseId: string }>;
}) {
  const { franchiseId } = await params;
  const rawCharacters = await getCharacters(franchiseId);
  const franchise = rawCharacters.length > 0 ? rawCharacters[0].franchise : null;

  // Filter out character with same name as franchise, and deduplicate by display name
  const franchiseName = franchise?.name || "";
  const franchiseZh = franchise?.name_zh || "";
  const seen = new Set<string>();
  const characters = rawCharacters.filter((c) => {
    const displayName = c.name_zh || c.name;
    if (displayName === franchiseName || displayName === franchiseZh) return false;
    if (seen.has(displayName)) return false;
    seen.add(displayName);
    return true;
  });

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <Link
        href="/browse"
        className="mono-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
      >
        ← 返回作品列表
      </Link>

      <div className="pb-[clamp(18px,3vh,28px)] pt-4">
        <h1 className="display">{franchise?.name_zh || franchise?.name || "作品"}</h1>
        {franchise?.name_zh && (
          <p className="mt-3 font-mono text-[11px] tracking-[0.1em] text-[var(--ink-2)]">
            {franchise.name}
          </p>
        )}
      </div>

      {characters.length === 0 ? (
        <p className="rule py-12 text-center text-[14px] text-[var(--ink-2)]">
          此作品尚無角色資料
        </p>
      ) : (
        <div className="rule grid grid-cols-2 gap-x-8 sm:grid-cols-3 lg:grid-cols-4">
          {characters.flatMap((character) => {
            // Lock to exact character + franchise so results don't include unrelated
            // figures whose names happen to contain the character string. If the
            // DB row holds a 「、」-merged multi-character name (1053 such rows
            // exist), render one entry per part so each links to a clean single-
            // character search instead of the whole literal string.
            const franchiseParam = franchiseName ? `&franchise=${encodeURIComponent(franchiseName)}` : "";
            const primary = character.name_zh || character.name;
            const parts = primary.includes("、")
              ? primary.split(/\s*、\s*/).filter(Boolean)
              : [primary];
            return parts.map((part, i) => (
              <Link
                key={`${character.id}-${i}`}
                href={`/search?character=${encodeURIComponent(part)}${franchiseParam}`}
                className="group border-b border-[var(--rule-faint)] py-3.5"
              >
                <span className="block text-[14px] text-[var(--ink-2)] transition-colors group-hover:text-[var(--ink)]">
                  {part}
                </span>
                {/* Romaji/JP secondary line only when we didn't split — for split
                    rows we can't reliably attribute it to a single part. */}
                {parts.length === 1 && character.name_zh && (
                  <span className="mt-1 block font-mono text-[10px] tracking-[0.12em] text-[var(--muted)]">
                    {character.name}
                  </span>
                )}
              </Link>
            ));
          })}
        </div>
      )}
    </div>
  );
}
