import { mapInChunks } from "@/operations/trackFilters";
import type { PlaylistCard } from "@/operations/types";
import { LIKED_SONGS_PLAYLIST_IDS } from "@/operations/types";

type RootlistItem = {
  type?: string;
  uri?: string;
  name?: string;
  isOwnedBySelf?: boolean;
  owner?: { username?: string; id?: string; uri?: string };
  images?: Array<{ url?: string }>;
  totalLength?: number;
  length?: number;
  items?: RootlistItem[];
};

function collectPlaylists(items: RootlistItem[]): RootlistItem[] {
  const playlists: RootlistItem[] = [];
  for (const item of items ?? []) {
    if (!item) continue;
    if (item.type === "playlist" || item.type === "playlist_v2") {
      playlists.push(item);
      continue;
    }
    if (item.type === "folder" && Array.isArray(item.items)) {
      playlists.push(...collectPlaylists(item.items));
    }
  }
  return playlists;
}

function isOwned(playlist: RootlistItem, currentUser: string): boolean {
  if (playlist.isOwnedBySelf === true) return true;
  const owner = playlist.owner ?? {};
  const ownerUsername = String(owner.username ?? owner.id ?? "");
  const ownerUri = String(owner.uri ?? "");
  return (
    ownerUsername === currentUser || ownerUri === `spotify:user:${currentUser}`
  );
}

export function isLikedSongsUri(uri?: string): boolean {
  if (!uri) return false;
  if (uri === "spotify:collection:tracks") return true;
  if (uri.includes("collection:tracks")) return true;
  const id = uri.split(":").pop() ?? "";
  return LIKED_SONGS_PLAYLIST_IDS.has(id);
}

export async function listOwnedPlaylists(): Promise<PlaylistCard[]> {
  const currentUser = Spicetify.Platform.username as string | undefined;
  const rootlist = await Spicetify.Platform.RootlistAPI.getContents();
  const playlists = collectPlaylists(rootlist?.items ?? []);

  const cards: PlaylistCard[] = [];

  for (const playlist of playlists) {
    if (!playlist.uri || isLikedSongsUri(playlist.uri)) continue;
    const owned = currentUser ? isOwned(playlist, currentUser) : false;
    if (!owned) continue;

    cards.push({
      uri: playlist.uri,
      name: playlist.name ?? "Untitled",
      trackCount: playlist.totalLength ?? playlist.length ?? 0,
      imageUrl: playlist.images?.[0]?.url,
      owned: true,
    });
  }

  // ponytail: chunk 8, raise if open still stalls on huge libraries
  await mapInChunks(
    cards,
    async (card) => {
      if (card.imageUrl && card.trackCount > 0) return;
      try {
        const meta = await Spicetify.Platform.PlaylistAPI.getMetadata(card.uri);
        if (!card.imageUrl) {
          card.imageUrl =
            meta?.images?.[0]?.url ?? meta?.image?.[0]?.url ?? meta?.cover?.url;
        }
        if (!card.trackCount) {
          card.trackCount = meta?.totalLength ?? meta?.length ?? 0;
        }
        if (meta?.name) card.name = meta.name;
      } catch {
        // keep rootlist data
      }
    },
    8,
  );

  return cards.sort((a, b) => a.name.localeCompare(b.name));
}
