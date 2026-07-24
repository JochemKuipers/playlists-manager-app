/**
 * Followed artist names for remix whitelist.
 * Tries Platform LibraryAPI first, then session Web API via CosmosAsync.
 */
export async function fetchFollowedArtistNames(): Promise<string[]> {
  const names = new Set<string>();

  const pushName = (value: unknown) => {
    if (typeof value === "string" && value.trim()) names.add(value.trim());
  };

  try {
    const lib = Spicetify.Platform?.LibraryAPI as
      | {
          getArtists?: (opts: {
            limit: number;
            offset?: number;
          }) => Promise<{ items?: Array<{ name?: string }> }>;
          getContents?: (opts: Record<string, unknown>) => Promise<{
            items?: Array<{ name?: string; type?: string }>;
          }>;
        }
      | undefined;

    if (typeof lib?.getArtists === "function") {
      const res = await lib.getArtists({ limit: -1, offset: 0 });
      for (const item of res?.items ?? []) pushName(item?.name);
    }

    if (
      names.size === 0 &&
      typeof lib?.getContents === "function"
    ) {
      // filters: "2" is artists in several Spotify client builds
      const res = await lib.getContents({
        filters: ["2"],
        offset: 0,
        limit: -1,
      });
      for (const item of res?.items ?? []) {
        if (!item?.type || /artist/i.test(item.type)) pushName(item?.name);
      }
    }
  } catch (error) {
    console.warn("[WARN] LibraryAPI followed artists failed:", error);
  }

  if (names.size > 0) return [...names];

  try {
    let after: string | undefined;
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({
        type: "artist",
        limit: "50",
      });
      if (after) params.set("after", after);

      const res = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/me/following?${params.toString()}`,
      );
      const block = res?.artists;
      for (const item of block?.items ?? []) pushName(item?.name);

      after =
        typeof block?.cursors?.after === "string"
          ? block.cursors.after
          : undefined;
      if (!after || !(block?.items?.length > 0)) break;
    }
  } catch (error) {
    console.warn("[WARN] Web API followed artists failed:", error);
  }

  return [...names];
}
