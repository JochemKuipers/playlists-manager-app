import {
  fetchAllLikedSongsTracks,
  removeTracksFromLikedSongs,
} from "@/api/library";
import { fetchPlaylistTracks, removeTracksFromPlaylist } from "@/api/playlist";
import { findDuplicates, getTrackToKeepIndex } from "@/operations/duplicates";
import { throwIfAborted } from "@/operations/normalize";
import type { OpResult, ProgressEvent } from "@/operations/types";
import type { ProgressFn } from "./update";

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
    emit("Scanning for duplicates…", "info", 0.1);

    const tracks = await fetchPlaylistTracks(playlistUri);
    if (tracks.length === 0) {
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "Playlist is empty",
      };
    }

    throwIfAborted(signal);
    const duplicateGroups = findDuplicates(tracks);
    if (duplicateGroups.length === 0) {
      emit("No duplicates found", "success", 1);
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "No duplicates found",
      };
    }

    const tracksToRemove: { uri: string; uid?: string }[] = [];

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
          tracksToRemove.push({
            uri: group.tracks[i].uri,
            uid: group.tracks[i].uid,
          });
        }
      }
    }

    if (tracksToRemove.length === 0) {
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "No duplicates to remove",
      };
    }

    throwIfAborted(signal);
    emit(`Removing ${tracksToRemove.length} duplicate(s)…`, "remove", 0.7);
    const removedCount = await removeTracksFromPlaylist(
      playlistUri,
      tracksToRemove,
    );

    if (removedCount === 0) {
      return {
        playlistUri,
        ok: false,
        removed: 0,
        message: "No duplicates removed (playlist may have changed)",
      };
    }

    emit(
      `Removed ${removedCount}/${tracksToRemove.length} duplicate(s)`,
      "remove",
      1,
    );
    return {
      playlistUri,
      ok: true,
      removed: removedCount,
      message: `Removed ${removedCount} duplicate(s)`,
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
    emit("Scanning Liked Songs for duplicates…", "info", 0.1);

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
    const duplicateGroups = findDuplicates(tracks);
    if (duplicateGroups.length === 0) {
      emit("No duplicates found", "success", 1);
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "No duplicates found",
      };
    }

    const urisToRemove: string[] = [];
    for (const group of duplicateGroups) {
      group.tracks.sort((a, b) => a.index - b.index);
      const keepIndex = getTrackToKeepIndex(group);
      const kept = group.tracks[keepIndex];
      emit(
        `Keeping "${kept.name}", removing ${group.tracks.length - 1} duplicate(s)`,
        "info",
      );
      for (let i = 0; i < group.tracks.length; i++) {
        if (i !== keepIndex) urisToRemove.push(group.tracks[i].uri);
      }
    }

    if (urisToRemove.length === 0) {
      return {
        playlistUri,
        ok: true,
        removed: 0,
        message: "No duplicates to remove",
      };
    }

    throwIfAborted(signal);
    emit(`Removing ${urisToRemove.length} duplicate(s)…`, "remove", 0.7);
    const removedCount = await removeTracksFromLikedSongs(urisToRemove);

    if (removedCount === 0) {
      return {
        playlistUri,
        ok: false,
        removed: 0,
        message: "No duplicates were removed from Liked Songs",
      };
    }

    emit(
      `Removed ${removedCount}/${urisToRemove.length} duplicate(s)`,
      "remove",
      1,
    );
    return {
      playlistUri,
      ok: true,
      removed: removedCount,
      message: `Removed ${removedCount} duplicate(s)`,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { playlistUri, ok: false, aborted: true, message: "Aborted" };
    }
    console.error("[ERROR] cleanLikedSongs:", error);
    return { playlistUri, ok: false, message: "Failed to clean Liked Songs" };
  }
}
