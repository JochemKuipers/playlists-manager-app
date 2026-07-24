import { getArtistTracks, searchArtist } from "@/api/graphql";
import { fetchFollowedArtistNames } from "@/api/following";
import {
  addTracksToPlaylist,
  fetchPlaylistTracks,
  getPlaylistMetadata,
} from "@/api/playlist";
import {
  addDurationEntry,
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
import type { ArtistTrack, OpResult, ProgressEvent } from "@/operations/types";
import { loadIgnoreSettings } from "@/settings";

export type ProgressFn = (event: ProgressEvent) => void;

export async function updatePlaylist(
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
    emit("Fetching playlist metadata…", "info", 0.05);

    const playlist = await getPlaylistMetadata(playlistUri);
    if (!playlist) {
      return {
        playlistUri,
        ok: false,
        message: "Failed to fetch playlist data",
      };
    }

    const playlistName = playlist.name || playlist.displayName || "";
    const artistNames = parseArtistsFromTitle(playlistName);

    if (artistNames.length === 0) {
      return {
        playlistUri,
        ok: false,
        message: 'No artists in title — use "Artist1 / Artist2"',
      };
    }

    throwIfAborted(signal);
    emit(`Found ${artistNames.length} artist(s) — searching…`, "info", 0.15);

    const artistResults = await Promise.all(
      artistNames.map((name) => searchArtist(name)),
    );
    const artistUris = artistResults.filter((uri): uri is string =>
      Boolean(uri),
    );

    for (let i = 0; i < artistNames.length; i++) {
      if (!artistResults[i]) {
        emit(`Could not find artist: ${artistNames[i]}`, "skip");
      } else {
        emit(`Matched artist: ${artistNames[i]}`, "success");
      }
    }

    if (artistUris.length === 0) {
      return { playlistUri, ok: false, message: "Could not find any artists" };
    }

    throwIfAborted(signal);
    emit(
      `Loading discographies for ${artistUris.length} artist(s)…`,
      "info",
      0.3,
    );

    const trackBatches = await Promise.all(
      artistUris.map((uri) => getArtistTracks(uri)),
    );
    const allArtistTracks = trackBatches.flat();
    emit(`Fetched ${allArtistTracks.length} artist track(s)`, "info", 0.55);

    throwIfAborted(signal);
    const existingTracks = await fetchPlaylistTracks(playlistUri);
    emit(`Loaded ${existingTracks.length} existing track(s)`, "info", 0.65);

    const existingTrackUris = new Set(existingTracks.map((t) => t.uri));
    const existingTracksByName = new Map<string, Array<number | null>>();
    for (const track of existingTracks) {
      addDurationEntry(
        existingTracksByName,
        normalizeTrackName(track.name),
        normalizeDuration(track.durationMs),
      );
    }

    const pendingTracksByName = new Map<string, Array<number | null>>();
    const candidates: ArtistTrack[] = [];

    for (const track of allArtistTracks) {
      if (!track.uri) continue;
      if (existingTrackUris.has(track.uri)) continue;

      const normalizedName = normalizeTrackName(track.name);
      const duration = normalizeDuration(track.durationMs);

      if (shouldSkipAddingTrack(existingTracksByName, normalizedName, duration))
        continue;
      if (shouldSkipAddingTrack(pendingTracksByName, normalizedName, duration))
        continue;

      addDurationEntry(pendingTracksByName, normalizedName, duration);
      candidates.push(track);
    }

    throwIfAborted(signal);
    const settings = loadIgnoreSettings();
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
      `Filtering ${candidates.length} candidate(s) with ignore settings…`,
      "info",
      0.75,
    );

    const verdicts = await mapInChunks(candidates, async (track) => {
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
        artistNames,
        { cache, compiledPatterns, followedArtists },
      );
    });

    const newTrackUris: string[] = [];
    let skipped = 0;
    for (let i = 0; i < candidates.length; i++) {
      const verdict = verdicts[i];
      if (verdict.junk) {
        skipped += 1;
        if (skipped <= 8) {
          emit(`Skip add "${candidates[i].name}" — ${verdict.reason}`, "skip");
        }
        continue;
      }
      newTrackUris.push(candidates[i].uri);
    }
    if (skipped > 8) {
      emit(`…and ${skipped - 8} more skipped by filters`, "skip");
    } else if (skipped > 0) {
      emit(`Skipped ${skipped} track(s) via ignore filters`, "skip");
    }

    if (newTrackUris.length === 0) {
      emit("Already up to date", "success", 1);
      return {
        playlistUri,
        ok: true,
        added: 0,
        message: skipped
          ? `Already up to date (${skipped} filtered)`
          : "Already up to date",
      };
    }

    throwIfAborted(signal);
    emit(`Adding ${newTrackUris.length} track(s)…`, "add", 0.85);
    const added = await addTracksToPlaylist(playlistUri, newTrackUris);
    if (!added) {
      return { playlistUri, ok: false, message: "Failed to add tracks" };
    }

    emit(`Added ${newTrackUris.length} track(s)`, "add", 1);
    return {
      playlistUri,
      ok: true,
      added: newTrackUris.length,
      message: `Added ${newTrackUris.length} track(s)`,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { playlistUri, ok: false, aborted: true, message: "Aborted" };
    }
    console.error("[ERROR] updatePlaylist:", error);
    return { playlistUri, ok: false, message: "Failed to update playlist" };
  }
}
