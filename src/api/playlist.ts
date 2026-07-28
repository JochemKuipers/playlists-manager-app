import type { PlaylistTrack } from "@/operations/types";
import { API_BATCH_SIZE } from "@/operations/types";

type RawTrack = {
  isPlayable?: boolean;
  uri: string;
  name: string;
  duration_ms?: number;
  durationMs?: number;
  duration?: { milliseconds?: number; totalMilliseconds?: number };
  artists?: Array<{ name?: string }>;
  is_explicit?: boolean;
  album?: { name?: string; images?: Array<{ url?: string }> };
  uid?: string;
  rowId?: string;
  rowid?: string;
};

function trackDurationMs(track: RawTrack): number {
  return (
    track.duration?.milliseconds ??
    track.duration?.totalMilliseconds ??
    track.durationMs ??
    track.duration_ms ??
    0
  );
}

function toPlaylistUri(uri: string): string {
  return uri.startsWith("spotify:playlist:") ? uri : `spotify:playlist:${uri}`;
}

export async function fetchPlaylistTracks(
  uri: string,
): Promise<PlaylistTrack[]> {
  const playlistUri = toPlaylistUri(uri);
  const res = await Spicetify.Platform.PlaylistAPI.getContents(playlistUri, {
    limit: -1,
  });

  const items = Array.isArray(res.items) ? (res.items as RawTrack[]) : [];
  return items
    .filter((track) => track.isPlayable !== false)
    .map((track, index) => ({
      uri: track.uri,
      name: track.name,
      durationMs: trackDurationMs(track),
      artists: (track.artists ?? [])
        .map((a) => a.name)
        .filter((n): n is string => Boolean(n)),
      albumName: track.album?.name,
      isLocal: track.uri.startsWith("spotify:local:"),
      isExplicit: track.is_explicit ?? false,
      albumImageUrl: track.album?.images?.[0]?.url,
      uid: track.uid ?? track.rowId ?? track.rowid,
      rowId: track.rowId ?? track.rowid,
      index,
    }));
}

export async function getPlaylistMetadata(
  playlistUri: string,
): Promise<{ name?: string; displayName?: string } | null> {
  try {
    const metadata =
      await Spicetify.Platform.PlaylistAPI.getMetadata(playlistUri);
    if (metadata?.name) return metadata;
  } catch (error) {
    console.warn("[WARN] getMetadata failed:", error);
  }
  return null;
}

export async function addTracksToPlaylist(
  playlistUri: string,
  trackUris: string[],
): Promise<number> {
  let added = 0;
  for (let i = 0; i < trackUris.length; i += API_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + API_BATCH_SIZE);
    try {
      await Spicetify.Platform.PlaylistAPI.add(playlistUri, batch, {
        after: "end",
      });
      added += batch.length;
    } catch (error) {
      console.error("[ERROR] PlaylistAPI.add failed:", error);
      break;
    }
  }
  return added;
}

export async function removeTracksFromPlaylist(
  playlistUri: string,
  tracksToRemove: { uri: string; uid?: string }[],
): Promise<number> {
  try {
    const latestTracks = await fetchPlaylistTracks(playlistUri);
    const latestUidsByUri = new Map<string, string[]>();
    for (const track of latestTracks) {
      if (!track.uid) continue;
      const list = latestUidsByUri.get(track.uri) ?? [];
      list.push(track.uid);
      latestUidsByUri.set(track.uri, list);
    }

    const uidsToRemove: { uri: string; uid: string }[] = [];
    const seen = new Set<string>();

    for (const item of tracksToRemove) {
      const candidates = latestUidsByUri.get(item.uri);
      if (!candidates?.length) continue;
      const nextUid = candidates.shift();
      if (!nextUid || seen.has(nextUid)) continue;
      seen.add(nextUid);
      uidsToRemove.push({ uri: item.uri, uid: nextUid });
    }

    if (uidsToRemove.length === 0) return 0;

    let removedCount = 0;
    for (let i = 0; i < uidsToRemove.length; i += API_BATCH_SIZE) {
      const batch = uidsToRemove.slice(i, i + API_BATCH_SIZE);
      try {
        await Spicetify.Platform.PlaylistAPI.remove(playlistUri, batch);
        removedCount += batch.length;
      } catch {
        for (const item of batch) {
          try {
            await Spicetify.Platform.PlaylistAPI.remove(playlistUri, [item]);
            removedCount += 1;
          } catch {
            // skip single failure
          }
        }
      }
    }
    return removedCount;
  } catch (error) {
    console.error("[ERROR] removeTracksFromPlaylist failed:", error);
    return 0;
  }
}
