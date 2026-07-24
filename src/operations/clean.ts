import { fetchFollowedArtistNames } from "@/api/following";
import {
  fetchAllLikedSongsTracks,
  removeTracksFromLikedSongs,
} from "@/api/library";
import {
  fetchPlaylistTracks,
  getPlaylistMetadata,
  removeTracksFromPlaylist,
} from "@/api/playlist";
import { findDuplicates, getTrackToKeepIndex } from "@/operations/duplicates";
import { parseArtistsFromTitle, throwIfAborted } from "@/operations/normalize";
import {
  compilePatterns,
  createOriginalCache,
  evaluateJunkTrack,
  mapInChunks,
} from "@/operations/trackFilters";
import type {
  OpResult,
  PlaylistTrack,
  ProgressEvent,
} from "@/operations/types";
import { loadIgnoreSettings, hasAnyIgnoreFilter } from "@/settings";
import type { ProgressFn } from "./update";

async function collectJunkRemovals(
  tracks: PlaylistTrack[],
  ownerArtistsFor: (track: PlaylistTrack) => string[],
  emit: (
    message: string,
    kind?: ProgressEvent["kind"],
    progress?: number,
  ) => void,
  signal?: AbortSignal,
): Promise<{ uri: string; uid?: string }[]> {
  const settings = loadIgnoreSettings();
  if (!hasAnyIgnoreFilter(settings)) return [];

  const cache = createOriginalCache();
  const compiledPatterns = compilePatterns(settings.customPatterns);
  const followedArtists = settings.skipDjRemixes
    ? await fetchFollowedArtistNames()
    : [];
  if (followedArtists.length > 0) {
    emit(
      `Loaded ${followedArtists.length} followed artist(s) for remix whitelist`,
      "info",
    );
  }

  emit(
    `Scanning ${tracks.length} track(s) against ignore filters…`,
    "info",
    0.25,
  );

  const verdicts = await mapInChunks(tracks, async (track) => {
    throwIfAborted(signal);
    return evaluateJunkTrack(
      {
        name: track.name,
        albumName: track.albumName,
        artists: track.artists,
        durationMs: track.durationMs,
        uri: track.uri,
      },
      settings,
      ownerArtistsFor(track),
      { cache, compiledPatterns, followedArtists },
    );
  });

  const junk: { uri: string; uid?: string }[] = [];
  let logged = 0;
  for (let i = 0; i < tracks.length; i++) {
    if (!verdicts[i].junk) continue;
    junk.push({ uri: tracks[i].uri, uid: tracks[i].uid });
    logged += 1;
    if (logged <= 8) {
      emit(`Remove "${tracks[i].name}" — ${verdicts[i].reason}`, "remove");
    }
  }
  if (logged > 8) {
    emit(`…and ${logged - 8} more junk track(s)`, "remove");
  } else if (logged > 0) {
    emit(`Found ${logged} junk track(s) via ignore filters`, "remove");
  }

  return junk;
}

function mergeRemovals(
  ...lists: { uri: string; uid?: string }[][]
): { uri: string; uid?: string }[] {
  const seen = new Set<string>();
  const out: { uri: string; uid?: string }[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.uid
        ? `uid:${item.uid}`
        : `uri:${item.uri}:${out.length}`;
      if (seen.has(key)) continue;
      // Also de-dupe by uri+uid pair loosely for liked songs (uri only)
      const uriKey = item.uid ? `u:${item.uri}|${item.uid}` : `u:${item.uri}`;
      if (seen.has(uriKey)) continue;
      seen.add(key);
      seen.add(uriKey);
      out.push(item);
    }
  }
  return out;
}

export async function cleanPlaylist(
  playlistUri: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<OpResult> {
  const emit = (
    message: string,
    kind: ProgressEvent["kind"] = "info",
    progress?: number,
  ) => {
    onProgress({ playlistUri, message, kind, progress });
  };

  try {
    throwIfAborted(signal);
    emit("Scanning playlist…", "info", 0.1);

    const tracks = await fetchPlaylistTracks(playlistUri);
    if (tracks.length === 0) {
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "Playlist is empty",
      };
    }

    const metadata = await getPlaylistMetadata(playlistUri);
    const playlistName = metadata?.name || metadata?.displayName || "";
    const ownerArtists = parseArtistsFromTitle(playlistName);

    throwIfAborted(signal);
    const junk = await collectJunkRemovals(
      tracks,
      (track) =>
        ownerArtists.length > 0
          ? ownerArtists
          : track.artists[0]
            ? [track.artists[0]]
            : [],
      emit,
      signal,
    );

    throwIfAborted(signal);
    const duplicateGroups = findDuplicates(tracks);
    const duplicateRemovals: { uri: string; uid?: string }[] = [];

    if (duplicateGroups.length === 0) {
      emit("No duplicates found", "success", 0.55);
    } else {
      for (const group of duplicateGroups) {
        group.tracks.sort((a, b) => a.index - b.index);
        const keepIndex = getTrackToKeepIndex(group);
        const kept = group.tracks[keepIndex];
        emit(
          `Keeping "${kept.name}" (${kept.isExplicit ? "explicit" : "clean"}, ${kept.isLocal ? "local" : "spotify"}), removing ${group.tracks.length - 1}`,
          "info",
        );
        for (let i = 0; i < group.tracks.length; i++) {
          if (i !== keepIndex) {
            duplicateRemovals.push({
              uri: group.tracks[i].uri,
              uid: group.tracks[i].uid,
            });
          }
        }
      }
    }

    const tracksToRemove = mergeRemovals(junk, duplicateRemovals);

    if (tracksToRemove.length === 0) {
      emit("Nothing to remove", "success", 1);
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "Nothing to remove",
      };
    }

    throwIfAborted(signal);
    emit(`Removing ${tracksToRemove.length} track(s)…`, "remove", 0.7);
    const removedCount = await removeTracksFromPlaylist(
      playlistUri,
      tracksToRemove,
    );

    if (removedCount === 0) {
      return {
        playlistUri,
        ok: false,
        removed: 0,
        message: "No tracks removed (playlist may have changed)",
      };
    }

    emit(
      `Removed ${removedCount}/${tracksToRemove.length} track(s)`,
      "remove",
      1,
    );
    return {
      playlistUri,
      ok: true,
      removed: removedCount,
      message: `Removed ${removedCount} track(s)`,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { playlistUri, ok: false, aborted: true, message: "Aborted" };
    }
    console.error("[ERROR] cleanPlaylist:", error);
    return { playlistUri, ok: false, message: "Failed to clean playlist" };
  }
}

export async function cleanLikedSongs(
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<OpResult> {
  const playlistUri = "spotify:collection:tracks";
  const emit = (
    message: string,
    kind: ProgressEvent["kind"] = "info",
    progress?: number,
  ) => {
    onProgress({ playlistUri, message, kind, progress });
  };

  try {
    throwIfAborted(signal);
    emit("Scanning Liked Songs…", "info", 0.1);

    const tracks = await fetchAllLikedSongsTracks();
    if (tracks.length === 0) {
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "Liked Songs is empty",
      };
    }

    throwIfAborted(signal);
    const junk = await collectJunkRemovals(
      tracks,
      (track) => (track.artists[0] ? [track.artists[0]] : []),
      emit,
      signal,
    );

    throwIfAborted(signal);
    const duplicateGroups = findDuplicates(tracks);
    const duplicateUris: string[] = [];

    if (duplicateGroups.length === 0) {
      emit("No duplicates found", "success", 0.55);
    } else {
      for (const group of duplicateGroups) {
        group.tracks.sort((a, b) => a.index - b.index);
        const keepIndex = getTrackToKeepIndex(group);
        const kept = group.tracks[keepIndex];
        emit(
          `Keeping "${kept.name}", removing ${group.tracks.length - 1} duplicate(s)`,
          "info",
        );
        for (let i = 0; i < group.tracks.length; i++) {
          if (i !== keepIndex) duplicateUris.push(group.tracks[i].uri);
        }
      }
    }

    const uriSet = new Set<string>([
      ...junk.map((j) => j.uri),
      ...duplicateUris,
    ]);
    const urisToRemove = [...uriSet];

    if (urisToRemove.length === 0) {
      emit("Nothing to remove", "success", 1);
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "Nothing to remove",
      };
    }

    throwIfAborted(signal);
    emit(`Removing ${urisToRemove.length} track(s)…`, "remove", 0.7);
    const removedCount = await removeTracksFromLikedSongs(urisToRemove);

    if (removedCount === 0) {
      return {
        playlistUri,
        ok: false,
        removed: 0,
        message: "No tracks were removed from Liked Songs",
      };
    }

    emit(
      `Removed ${removedCount}/${urisToRemove.length} track(s)`,
      "remove",
      1,
    );
    return {
      playlistUri,
      ok: true,
      removed: removedCount,
      message: `Removed ${removedCount} track(s)`,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { playlistUri, ok: false, aborted: true, message: "Aborted" };
    }
    console.error("[ERROR] cleanLikedSongs:", error);
    return { playlistUri, ok: false, message: "Failed to clean Liked Songs" };
  }
}
