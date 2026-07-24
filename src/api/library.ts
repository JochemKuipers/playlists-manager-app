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

export async function fetchAllLikedSongsTracks(): Promise<PlaylistTrack[]> {
  try {
    // ponytail: LibraryAPI over dead CosmosAsync collection endpoints
    const res = await Spicetify.Platform.LibraryAPI.getTracks({ limit: -1 });
    const items = (res?.items ?? []) as RawLiked[];
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
  } catch (error) {
    console.error("[ERROR] Failed to fetch Liked Songs:", error);
    return [];
  }
}

export async function getLikedSongsTrackCount(): Promise<number> {
  try {
    const res = await Spicetify.Platform.LibraryAPI.getTracks({
      limit: 1,
      offset: 0,
    });
    const total =
      res?.totalLength ??
      res?.totalCount ??
      res?.total ??
      res?.length ??
      null;
    if (typeof total === "number" && total >= 0) return total;

    // Fallback: full fetch when API omits a total field
    const all = await fetchAllLikedSongsTracks();
    return all.length;
  } catch (error) {
    console.error("[ERROR] Failed to count Liked Songs:", error);
    return 0;
  }
}

export async function removeTracksFromLikedSongs(
  trackUris: string[],
): Promise<number> {
  let removedCount = 0;
  for (let i = 0; i < trackUris.length; i += API_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + API_BATCH_SIZE);
    try {
      await Spicetify.Platform.LibraryAPI.remove({ uris: batch });
      removedCount += batch.length;
    } catch (error) {
      console.error("[ERROR] LibraryAPI.remove failed:", error);
    }
  }
  return removedCount;
}

export async function addTracksToLikedSongs(
  trackUris: string[],
): Promise<number> {
  let likedCount = 0;
  for (let i = 0; i < trackUris.length; i += API_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + API_BATCH_SIZE);
    try {
      await Spicetify.Platform.LibraryAPI.add({ uris: batch });
      likedCount += batch.length;
    } catch (error) {
      console.error("[ERROR] LibraryAPI.add failed:", error);
    }
  }
  return likedCount;
}
