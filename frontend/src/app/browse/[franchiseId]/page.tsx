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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-2">
        <Link href="/browse" className="text-xs text-[#6e7681] transition-colors hover:text-[#C4A265]">
          &larr; 返回作品列表
        </Link>
      </div>
      <h1 className="mb-1 text-xl font-bold text-[#e6edf3] sm:text-2xl">
        {franchise?.name_zh || franchise?.name || "作品"}
      </h1>
      {franchise?.name_zh && (
        <p className="mb-6 text-sm text-[#6e7681]">{franchise.name}</p>
      )}

      {characters.length === 0 ? (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-10 text-center">
          <p className="text-sm text-[#6e7681]">此作品尚無角色資料</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
          {characters.flatMap((character) => {
            // Lock to exact character + franchise so results don't include unrelated
            // figures whose names happen to contain the character string. If the
            // DB row holds a 「、」-merged multi-character name (1053 such rows
            // exist), render one card per part so each links to a clean single-
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
                className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 transition-all hover:border-[#484f58] sm:p-4"
              >
                <p className="text-sm font-medium text-[#c9d1d9]">{part}</p>
                {/* English/jp secondary line only shown when we didn't split — for
                    split rows we can't reliably attribute the romaji to a part. */}
                {parts.length === 1 && character.name_zh && (
                  <p className="mt-0.5 text-xs text-[#6e7681]">{character.name}</p>
                )}
              </Link>
            ));
          })}
        </div>
      )}
    </div>
  );
}
