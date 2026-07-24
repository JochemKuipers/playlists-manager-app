import { addTracksToLikedSongs, fetchAllLikedSongsTracks } from "@/api/library";
import { fetchPlaylistTracks } from "@/api/playlist";
import {
  addDurationEntry,
  normalizeDuration,
  normalizeTrackName,
  shouldSkipAddingTrack,
  throwIfAborted,
} from "@/operations/normalize";
import type {
  LikedSongsIndex,
  OpResult,
  ProgressEvent,
} from "@/operations/types";
import type { ProgressFn } from "./update";

export async function buildLikedSongsIndex(): Promise<LikedSongsIndex> {
  const tracks = await fetchAllLikedSongsTracks();
  const uris = new Set(tracks.map((t) => t.uri));
  const byName = new Map<string, Array<number | null>>();
  for (const track of tracks) {
    addDurationEntry(
      byName,
      normalizeTrackName(track.name),
      normalizeDuration(track.durationMs),
    );
  }
  return { uris, byName, tracks };
}

export async function likeMissingPlaylistTracks(
  playlistUri: string,
  onProgress: ProgressFn,
  options?: { signal?: AbortSignal; likedIndex?: LikedSongsIndex },
): Promise<OpResult> {
  const emit = (
    message: string,
    kind: ProgressEvent["kind"] = "info",
    progress?: number,
  ) => {
    onProgress({ playlistUri, message, kind, progress });
  };

  try {
    throwIfAborted(options?.signal);
    emit("Comparing playlist to Liked Songs…", "info", 0.1);

    const likedIndex = options?.likedIndex ?? (await buildLikedSongsIndex());

    throwIfAborted(options?.signal);
    const playlistTracks = await fetchPlaylistTracks(playlistUri);

    if (playlistTracks.length === 0) {
      return { playlistUri, ok: true, liked: 0, message: "Playlist is empty" };
    }

    emit(
      `Playlist ${playlistTracks.length} · Liked ${likedIndex.tracks.length}`,
      "info",
      0.4,
    );

    const urisToLike: string[] = [];
    const pendingByName = new Map<string, Array<number | null>>();

    for (const track of playlistTracks) {
      if (!track.uri || track.isLocal) continue;
      if (likedIndex.uris.has(track.uri)) continue;

      const normalizedName = normalizeTrackName(track.name);
      const duration = normalizeDuration(track.durationMs);

      if (shouldSkipAddingTrack(likedIndex.byName, normalizedName, duration))
        continue;
      if (shouldSkipAddingTrack(pendingByName, normalizedName, duration))
        continue;

      addDurationEntry(pendingByName, normalizedName, duration);
      urisToLike.push(track.uri);
    }

    if (urisToLike.length === 0) {
      emit("All tracks already in Liked Songs", "success", 1);
      return {
        playlistUri,
        ok: true,
        liked: 0,
        message: "All tracks already in Liked Songs",
      };
    }

    throwIfAborted(options?.signal);
    emit(`Liking ${urisToLike.length} track(s)…`, "add", 0.75);
    const likedCount = await addTracksToLikedSongs(urisToLike);

    // Keep shared index fresh for subsequent playlists in the same batch
    const likedSet = new Set(urisToLike.slice(0, likedCount));
    for (const track of playlistTracks) {
      if (!likedSet.has(track.uri)) continue;
      likedIndex.uris.add(track.uri);
      addDurationEntry(
        likedIndex.byName,
        normalizeTrackName(track.name),
        normalizeDuration(track.durationMs),
      );
    }

    if (likedCount === 0) {
      return {
        playlistUri,
        ok: false,
        liked: 0,
        message: "Failed to like tracks",
      };
    }

    emit(`Liked ${likedCount}/${urisToLike.length} track(s)`, "add", 1);
    return {
      playlistUri,
      ok: true,
      liked: likedCount,
      message: `Liked ${likedCount} track(s)`,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { playlistUri, ok: false, aborted: true, message: "Aborted" };
    }
    console.error("[ERROR] likeMissing:", error);
    return { playlistUri, ok: false, message: "Failed to like missing tracks" };
  }
}
