import type { PlaylistTrack } from "@/operations/types";
import { API_BATCH_SIZE } from "@/operations/types";

type RawLiked = {
  isPlayable?: boolean;
  uri: string;
  name: string;
  duration?: { milliseconds?: number };
  durationMs?: number;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  isExplicit?: boolean;
  is_explicit?: boolean;
  album?: { name?: string; images?: Array<{ url?: string }> };
  uid?: string;
};

type LibraryTracksResponse = {
  items?: RawLiked[];
  totalLength?: number;
  totalCount?: number;
  total?: number;
  length?: number;
};

function mapLikedItems(items: RawLiked[]): PlaylistTrack[] {
  return items
    .filter((track) => track.isPlayable !== false)
    .map((track, index) => ({
      uri: track.uri,
      name: track.name,
      durationMs:
        track.duration?.milliseconds ??
        track.durationMs ??
        track.duration_ms ??
        0,
      artists: (track.artists ?? [])
        .map((a) => a.name)
        .filter((n): n is string => Boolean(n)),
      albumName: track.album?.name,
      isLocal: track.uri.startsWith("spotify:local:"),
      isExplicit: track.isExplicit ?? track.is_explicit ?? false,
      albumImageUrl: track.album?.images?.[0]?.url,
      uid: track.uid,
      index,
    }));
}

export async function fetchAllLikedSongsTracks(): Promise<PlaylistTrack[]> {
  // ponytail: LibraryAPI over dead CosmosAsync collection endpoints
  const res = (await Spicetify.Platform.LibraryAPI.getTracks({
    limit: -1,
  })) as LibraryTracksResponse;
  if (!Array.isArray(res.items)) {
    throw new Error("Unexpected LibraryAPI shape");
  }
  return mapLikedItems(res.items);
}

export async function getLikedSongsTrackCount(): Promise<number> {
  const res = (await Spicetify.Platform.LibraryAPI.getTracks({
    limit: 1,
    offset: 0,
  })) as LibraryTracksResponse;
  const total =
    res.totalLength ?? res.totalCount ?? res.total ?? res.length ?? null;
  if (typeof total === "number" && total >= 0) return total;

  const all = await fetchAllLikedSongsTracks();
  return all.length;
}

export async function removeTracksFromLikedSongs(
  trackUris: string[],
): Promise<string[]> {
  const removed: string[] = [];
  for (let i = 0; i < trackUris.length; i += API_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + API_BATCH_SIZE);
    try {
      await Spicetify.Platform.LibraryAPI.remove({ uris: batch });
      removed.push(...batch);
    } catch (error) {
      console.error("[ERROR] LibraryAPI.remove failed:", error);
    }
  }
  return removed;
}

export async function addTracksToLikedSongs(
  trackUris: string[],
): Promise<string[]> {
  const liked: string[] = [];
  for (let i = 0; i < trackUris.length; i += API_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + API_BATCH_SIZE);
    try {
      await Spicetify.Platform.LibraryAPI.add({ uris: batch });
      liked.push(...batch);
    } catch (error) {
      console.error("[ERROR] LibraryAPI.add failed:", error);
    }
  }
  return liked;
}
