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

const OWNERSHIP_CACHE_TTL_MS = 15_000;

let ownedUris = new Set<string>();
let cacheReady = false;
let fetchedAt = 0;
let loading: Promise<void> | null = null;

function cacheIsFresh(): boolean {
  return cacheReady && Date.now() - fetchedAt < OWNERSHIP_CACHE_TTL_MS;
}

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

export async function refreshOwnedPlaylistUris(
  force = false,
): Promise<Set<string>> {
  if (!force && cacheIsFresh()) return ownedUris;
  if (loading) {
    await loading;
    return ownedUris;
  }

  loading = (async () => {
    try {
      const currentUser = Spicetify.Platform.username as string | undefined;
      if (!currentUser) {
        cacheReady = true;
        fetchedAt = Date.now();
        return;
      }
      const rootlist = await Spicetify.Platform.RootlistAPI.getContents();
      const playlists = collectPlaylists(rootlist?.items ?? []);
      ownedUris = new Set();
      for (const playlist of playlists) {
        if (playlist.uri && isOwned(playlist, currentUser)) {
          ownedUris.add(playlist.uri);
        }
      }
    } catch (error) {
      console.warn("[WARN] Failed to refresh owned playlist cache:", error);
    } finally {
      cacheReady = true;
      fetchedAt = Date.now();
      loading = null;
    }
  })();

  await loading;
  return ownedUris;
}

export function isOwnedPlaylist(uri: string): boolean {
  return ownedUris.has(uri);
}

export async function listOwnedPlaylists(): Promise<PlaylistCard[]> {
  const currentUser = Spicetify.Platform.username as string | undefined;
  const rootlist = await Spicetify.Platform.RootlistAPI.getContents();
  const playlists = collectPlaylists(rootlist?.items ?? []);

  ownedUris = new Set();
  const cards: PlaylistCard[] = [];

  for (const playlist of playlists) {
    if (!playlist.uri || isLikedSongsUri(playlist.uri)) continue;
    const owned = currentUser ? isOwned(playlist, currentUser) : false;
    if (owned) ownedUris.add(playlist.uri);
    if (!owned) continue;

    cards.push({
      uri: playlist.uri,
      name: playlist.name ?? "Untitled",
      trackCount: playlist.totalLength ?? playlist.length ?? 0,
      imageUrl: playlist.images?.[0]?.url,
      owned: true,
    });
  }

  cacheReady = true;
  fetchedAt = Date.now();

  // Hydrate missing images / counts in parallel where rootlist was sparse
  await Promise.all(
    cards.map(async (card) => {
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
    }),
  );

  return cards.sort((a, b) => a.name.localeCompare(b.name));
}
