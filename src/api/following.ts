/**
 * Followed artist names for remix whitelist.
 * LibraryAPI only — CosmosAsync /me/following 429s on current Spotify.
 */

const PAGE = 50;
const TTL_MS = 5 * 60 * 1000;

type LibraryArtists = {
  getArtists?: (opts: {
    limit: number;
    offset?: number;
  }) => Promise<{ items?: unknown[] }>;
  getContents?: (opts: Record<string, unknown>) => Promise<{
    items?: unknown[];
  }>;
};

let cached: { names: string[]; at: number } | null = null;
let inflight: Promise<string[]> | null = null;

function pushName(names: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) names.add(value.trim());
}

function itemName(item: unknown): unknown {
  if (!item || typeof item !== "object") return undefined;
  const row = item as Record<string, unknown>;
  const nested = row.item ?? row.artist ?? row.data;
  if (typeof row.name === "string") return row.name;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    const profile = n.profile as Record<string, unknown> | undefined;
    return n.name ?? profile?.name;
  }
  return undefined;
}

async function paginate(
  fetchPage: (offset: number) => Promise<unknown[]>,
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let offset = 0; offset < PAGE * 200; offset += PAGE) {
    const page = await fetchPage(offset);
    if (!page.length) break;
    items.push(...page);
    if (page.length < PAGE) break;
  }
  return items;
}

async function loadFollowedArtistNames(): Promise<string[]> {
  const names = new Set<string>();
  const lib = Spicetify.Platform?.LibraryAPI as LibraryArtists | undefined;

  try {
    if (typeof lib?.getArtists === "function") {
      const items = await paginate(async (offset) => {
        const res = await lib.getArtists!({ limit: PAGE, offset });
        return res?.items ?? [];
      });
      for (const item of items) pushName(names, itemName(item));
    }

    if (names.size === 0 && typeof lib?.getContents === "function") {
      const items = await paginate(async (offset) => {
        const res = await lib.getContents!({
          filters: ["2"],
          offset,
          limit: PAGE,
        });
        return res?.items ?? [];
      });
      for (const item of items) pushName(names, itemName(item));
    }
  } catch (error) {
    console.warn("[WARN] LibraryAPI followed artists failed:", error);
  }

  return [...names];
}

export async function fetchFollowedArtistNames(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.names;
  if (inflight) return inflight;

  inflight = loadFollowedArtistNames()
    .then((names) => {
      cached = { names, at: Date.now() };
      return names;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
