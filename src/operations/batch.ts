import { cleanLikedSongs, cleanPlaylist } from "@/operations/clean";
import {
  buildLikedSongsIndex,
  likeMissingPlaylistTracks,
} from "@/operations/likeMissing";
import type {
  LikedSongsIndex,
  OperationKind,
  OpResult,
  ProgressEvent,
} from "@/operations/types";
import { LIKED_SONGS_URI } from "@/operations/types";
import { updatePlaylist } from "@/operations/update";

export type BatchCallbacks = {
  onProgress: (event: ProgressEvent) => void;
  onItemStart: (uri: string) => void;
  onItemDone: (result: OpResult) => void;
};

export async function runBatch(options: {
  kind: OperationKind;
  uris: string[];
  signal?: AbortSignal;
  callbacks: BatchCallbacks;
}): Promise<OpResult[]> {
  const { kind, uris, signal, callbacks } = options;

  if (kind === "clean" && uris.length === 1 && uris[0] === LIKED_SONGS_URI) {
    callbacks.onItemStart(LIKED_SONGS_URI);
    const result = await cleanLikedSongs(callbacks.onProgress, signal);
    callbacks.onItemDone(result);
    return [result];
  }

  let likedIndex: LikedSongsIndex | undefined;
  if (kind === "likeMissing") {
    callbacks.onProgress({
      playlistUri: "",
      message: "Loading Liked Songs once for this batch…",
      kind: "info",
    });
    likedIndex = await buildLikedSongsIndex();
    callbacks.onProgress({
      playlistUri: "",
      message: `Liked Songs loaded (${likedIndex.tracks.length} tracks)`,
      kind: "success",
    });
  }

  const results = await Promise.all(
    uris.map(async (uri) => {
      callbacks.onItemStart(uri);
      let result: OpResult;
      try {
        if (signal?.aborted) {
          result = {
            playlistUri: uri,
            ok: false,
            aborted: true,
            message: "Aborted",
          };
        } else if (kind === "update") {
          result = await updatePlaylist(uri, callbacks.onProgress, signal);
        } else if (kind === "clean") {
          result = await cleanPlaylist(uri, callbacks.onProgress, signal);
        } else {
          result = await likeMissingPlaylistTracks(uri, callbacks.onProgress, {
            signal,
            likedIndex,
          });
        }
      } catch (error) {
        result = {
          playlistUri: uri,
          ok: false,
          message: error instanceof Error ? error.message : "Unknown error",
        };
      }
      callbacks.onItemDone(result);
      return result;
    }),
  );

  return results;
}
