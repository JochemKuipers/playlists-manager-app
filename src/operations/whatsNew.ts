import { extractArtistId, isAiArtist, loadAiArtistIds } from "@/api/aiArtists";
import { fetchFollowedArtistNames } from "@/api/following";
import {
  fetchWhatsNewFeed,
  getAlbumTracks,
  searchArtist,
  type WhatsNewAlbum,
} from "@/api/graphql";
import { addTracksToLikedSongs } from "@/api/library";
import { addTracksToPlaylist, fetchPlaylistTracks } from "@/api/playlist";
import { listOwnedPlaylists } from "@/api/rootlist";
import {
  abortable,
  addDurationEntry,
  getArtistIdFromUri,
  normalizeDuration,
  normalizeTrackName,
  parseArtistsFromTitle,
  shouldSkipAddingTrack,
  throwIfAborted,
} from "@/operations/normalize";
import {
  compilePatterns,
  createOriginalCache,
  evaluateJunkTrack,
  mapInChunks,
} from "@/operations/trackFilters";
import type {
  ArtistTrack,
  LikedSongsIndex,
  OpResult,
  PlaylistTrack,
  ProgressEvent,
} from "@/operations/types";
import { WHATS_NEW_URI } from "@/operations/types";
import { loadIgnoreSettings } from "@/settings";
import { buildLikedSongsIndex } from "./likeMissing";
import type { ProgressFn } from "./update";

const CURSOR_KEY = "playlist-manager-whatsnew-cursor";
const ALBUM_CONCURRENCY = 3;

function loadCursor(): string | null {
  try {
    return Spicetify.LocalStorage.get(CURSOR_KEY) || null;
  } catch {
    return null;
  }
}

function saveCursor(iso: string): void {
  try {
    Spicetify.LocalStorage.set(CURSOR_KEY, iso);
  } catch (error) {
    console.warn("[WARN] Failed to save What's New cursor:", error);
  }
}

async function buildArtistPlaylistMap(
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<Map<string, string[]>> {
  const playlists = await abortable(listOwnedPlaylists(), signal);
  const map = new Map<string, string[]>();

  for (const playlist of playlists) {
    throwIfAborted(signal);
    const names = parseArtistsFromTitle(playlist.name);
    if (names.length === 0) continue;

    const uris = await Promise.all(names.map((name) => searchArtist(name)));
    for (let i = 0; i < names.length; i++) {
      const uri = uris[i];
      if (!uri) continue;
      const id = getArtistIdFromUri(uri);
      if (!id) continue;
      const list = map.get(id) ?? [];
      if (!list.includes(playlist.uri)) list.push(playlist.uri);
      map.set(id, list);
    }
  }

  onProgress({
    playlistUri: WHATS_NEW_URI,
    message: `Mapped ${map.size} artist(s) → playlists`,
    kind: "info",
  });
  return map;
}

function trackArtistIds(track: ArtistTrack, album: WhatsNewAlbum): string[] {
  const ids = new Set<string>();
  for (const a of track.artists) {
    const id = extractArtistId(a.uri) ?? getArtistIdFromUri(a.uri);
    if (id) ids.add(id);
  }
  for (const a of album.artists) {
    const id = extractArtistId(a.uri) ?? getArtistIdFromUri(a.uri);
    if (id) ids.add(id);
  }
  return [...ids];
}

function playlistUrisForTrack(
  artistIds: string[],
  artistPlaylists: Map<string, string[]>,
): string[] {
  const uris = new Set<string>();
  for (const id of artistIds) {
    for (const playlistUri of artistPlaylists.get(id) ?? []) {
      uris.add(playlistUri);
    }
  }
  return [...uris];
}

type PlaylistIndex = {
  uris: Set<string>;
  byName: Map<string, Array<number | null>>;
};

function indexFromTracks(tracks: PlaylistTrack[]): PlaylistIndex {
  const uris = new Set(tracks.map((t) => t.uri));
  const byName = new Map<string, Array<number | null>>();
  for (const track of tracks) {
    addDurationEntry(
      byName,
      normalizeTrackName(track.name),
      normalizeDuration(track.durationMs),
    );
  }
  return { uris, byName };
}

function shouldAdd(
  track: ArtistTrack,
  index: { uris: Set<string>; byName: Map<string, Array<number | null>> },
  pendingByName: Map<string, Array<number | null>>,
): boolean {
  if (!track.uri || index.uris.has(track.uri)) return false;
  const name = normalizeTrackName(track.name);
  const duration = normalizeDuration(track.durationMs);
  if (shouldSkipAddingTrack(index.byName, name, duration)) return false;
  if (shouldSkipAddingTrack(pendingByName, name, duration)) return false;
  addDurationEntry(pendingByName, name, duration);
  return true;
}

export async function syncWhatsNew(
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<OpResult> {
  const playlistUri = WHATS_NEW_URI;
  const emit = (
    message: string,
    kind: ProgressEvent["kind"] = "info",
    progress?: number,
  ) => {
    onProgress({ playlistUri, message, kind, progress });
  };

  try {
    throwIfAborted(signal);
    const cursor = loadCursor();
    emit(
      cursor
        ? `Loading What's New (after ${cursor})…`
        : "Loading What's New feed…",
      "info",
      0.05,
    );

    const feed = await abortable(fetchWhatsNewFeed(signal), signal);
    const albums = feed.filter((a) => {
      if (!a.timestamp) return !cursor;
      return !cursor || a.timestamp > cursor;
    });

    let maxTimestamp = cursor ?? "";
    for (const album of albums) {
      if (album.timestamp && album.timestamp > maxTimestamp) {
        maxTimestamp = album.timestamp;
      }
    }

    emit(
      `${albums.length} new release(s) of ${feed.length} feed item(s)`,
      "info",
      0.12,
    );

    if (albums.length === 0) {
      emit("No new What's New items", "success", 1);
      return {
        playlistUri,
        ok: true,
        added: 0,
        liked: 0,
        message: "No new What's New items",
      };
    }

    throwIfAborted(signal);
    emit("Building artist → playlist map…", "info", 0.18);
    const artistPlaylists = await buildArtistPlaylistMap(onProgress, signal);

    const settings = loadIgnoreSettings();
    let aiIds = new Set<string>();
    if (settings.skipAiArtists) {
      emit("Loading AI artist blocklists…", "info", 0.22);
      aiIds = await abortable(loadAiArtistIds(), signal);
      emit(`AI blocklist: ${aiIds.size} artist(s)`, "info", 0.25);
    }

    emit("Loading Liked Songs…", "info", 0.3);
    const likedIndex: LikedSongsIndex = await abortable(
      buildLikedSongsIndex(),
      signal,
    );

    const cache = createOriginalCache();
    const compiledPatterns = compilePatterns(settings.customPatterns);
    const followedArtists = settings.skipDjRemixes
      ? await abortable(fetchFollowedArtistNames(), signal)
      : [];

    const toLike: string[] = [];
    const likePending = new Map<string, Array<number | null>>();
    const playlistAdds = new Map<string, string[]>();
    const playlistIndexes = new Map<string, PlaylistIndex>();
    const playlistPending = new Map<
      string,
      Map<string, Array<number | null>>
    >();

    let filtered = 0;
    let aiSkipped = 0;
    let processed = 0;

    await mapInChunks(
      albums,
      async (album) => {
        throwIfAborted(signal);
        processed += 1;
        if (processed % 5 === 0 || processed === albums.length) {
          emit(
            `Processing albums ${processed}/${albums.length}…`,
            "info",
            0.3 + (0.5 * processed) / albums.length,
          );
        }

        let tracks: ArtistTrack[];
        try {
          tracks = await getAlbumTracks(album.uri, album.name);
        } catch (error) {
          emit(
            `Failed album "${album.name}": ${error instanceof Error ? error.message : "error"}`,
            "skip",
          );
          return;
        }

        const ownerNames = album.artists.map((a) => a.name).filter(Boolean);

        for (const track of tracks) {
          const artistIds = trackArtistIds(track, album);

          if (settings.skipAiArtists) {
            const aiHit = artistIds.some((id) => isAiArtist(id, aiIds));
            if (aiHit) {
              aiSkipped += 1;
              if (aiSkipped <= 8) {
                emit(`Skip AI "${track.name}"`, "skip");
              }
              continue;
            }
          }

          const verdict = await evaluateJunkTrack(
            {
              name: track.name,
              albumName: track.albumName || album.name,
              artists: track.artists,
              durationMs: track.durationMs,
              uri: track.uri,
            },
            settings,
            ownerNames,
            { cache, compiledPatterns, followedArtists },
          );

          if (verdict.junk) {
            filtered += 1;
            if (filtered <= 8) {
              emit(`Skip "${track.name}" — ${verdict.reason}`, "skip");
            }
            continue;
          }

          if (shouldAdd(track, likedIndex, likePending)) {
            toLike.push(track.uri);
          }

          const targets = playlistUrisForTrack(artistIds, artistPlaylists);
          for (const targetUri of targets) {
            let index = playlistIndexes.get(targetUri);
            if (!index) {
              try {
                const existing = await fetchPlaylistTracks(targetUri);
                index = indexFromTracks(existing);
                playlistIndexes.set(targetUri, index);
              } catch {
                index = { uris: new Set(), byName: new Map() };
                playlistIndexes.set(targetUri, index);
              }
            }
            let pending = playlistPending.get(targetUri);
            if (!pending) {
              pending = new Map();
              playlistPending.set(targetUri, pending);
            }
            if (!shouldAdd(track, index, pending)) continue;
            const list = playlistAdds.get(targetUri) ?? [];
            list.push(track.uri);
            playlistAdds.set(targetUri, list);
          }
        }
      },
      ALBUM_CONCURRENCY,
    );

    if (filtered > 8) {
      emit(`…and ${filtered - 8} more skipped by ignore filters`, "skip");
    }
    if (aiSkipped > 8) {
      emit(`…and ${aiSkipped - 8} more skipped as AI`, "skip");
    }

    throwIfAborted(signal);
    const uniqueLike = [...new Set(toLike)];
    let liked = 0;
    if (uniqueLike.length > 0) {
      emit(`Liking ${uniqueLike.length} track(s)…`, "add", 0.85);
      const likedUris = await abortable(
        addTracksToLikedSongs(uniqueLike),
        signal,
      );
      liked = likedUris.length;
    }

    let added = 0;
    const playlistEntries = [...playlistAdds.entries()];
    if (playlistEntries.length > 0) {
      emit(`Adding to ${playlistEntries.length} playlist(s)…`, "add", 0.92);
      for (const [targetUri, uris] of playlistEntries) {
        throwIfAborted(signal);
        const unique = [...new Set(uris)];
        const n = await abortable(
          addTracksToPlaylist(targetUri, unique),
          signal,
        );
        added += n;
      }
    }

    if (maxTimestamp) saveCursor(maxTimestamp);

    const message = `What's New: liked ${liked}, added ${added} to playlists (${filtered} filtered, ${aiSkipped} AI)`;
    emit(message, "success", 1);
    return {
      playlistUri,
      ok: true,
      liked,
      added,
      message,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return {
        playlistUri,
        ok: false,
        aborted: true,
        message: "Aborted",
      };
    }
    console.error("[ERROR] syncWhatsNew:", error);
    return {
      playlistUri,
      ok: false,
      message:
        error instanceof Error ? error.message : "What's New sync failed",
    };
  }
}
