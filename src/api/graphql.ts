import { getArtistIdFromUri } from "@/operations/normalize";
import type { ArtistAlbum, ArtistTrack } from "@/operations/types";
import { ALBUM_FETCH_CONCURRENCY } from "@/operations/types";

export async function searchArtist(artistName: string): Promise<string | null> {
  const normalizedQuery = artistName.trim().toLowerCase();
  const def = Spicetify.GraphQL.Definitions?.assistedCurationSearch;
  if (!def) {
    console.warn("[WARN] assistedCurationSearch definition missing");
    return null;
  }

  try {
    const response = await Spicetify.GraphQL.Request(def, {
      term: artistName,
      limit: 10,
      numberOfTopResults: 10,
    });

    const artistUris: string[] = [];
    const pushArtistUri = (uri: unknown) => {
      if (
        typeof uri === "string" &&
        uri.startsWith("spotify:artist:") &&
        !artistUris.includes(uri)
      ) {
        artistUris.push(uri);
      }
    };

    for (const entry of response?.data?.searchV2?.topResultsV2?.itemsV2 ?? []) {
      pushArtistUri(entry?.item?.data?.uri);
    }
    for (const item of response?.data?.searchV2?.artists?.items ?? []) {
      pushArtistUri(item?.data?.uri);
    }

    if (artistUris.length === 0) return null;

    const minimalDef = Spicetify.GraphQL.Definitions?.queryArtistMinimal;
    if (minimalDef) {
      for (const uri of artistUris) {
        try {
          const { data } = await Spicetify.GraphQL.Request(minimalDef, { uri });
          const name = data?.artistUnion?.profile?.name
            ?.trim?.()
            ?.toLowerCase?.();
          if (name === normalizedQuery) return uri;
        } catch {
          // fall through
        }
      }
    }

    return artistUris[0];
  } catch (error) {
    console.warn(`[WARN] Artist search failed for ${artistName}:`, error);
    return null;
  }
}

export async function getArtistDiscography(
  artistId: string,
): Promise<ArtistAlbum[]> {
  const discog: ArtistAlbum[] = [];
  const seenAlbumIds = new Set<string>();
  let offset = 0;
  let hasNextPage = true;
  const artistAlbumQuery =
    Spicetify.GraphQL.Definitions.queryArtistDiscographyAll;

  while (hasNextPage) {
    try {
      const response = await Spicetify.GraphQL.Request(artistAlbumQuery, {
        uri: `spotify:artist:${artistId}`,
        offset,
        limit: 50,
      });

      const items = response?.data?.artistUnion?.discography?.all?.items;
      if (!items?.length) break;

      for (const item of items) {
        for (const release of item.releases?.items || []) {
          if (seenAlbumIds.has(release.id)) continue;
          discog.push({
            id: release.id,
            name: release.name,
            date:
              release.date?.isoString || release.date?.year?.toString() || "",
            albumType: release.type || "album",
          });
          seenAlbumIds.add(release.id);
        }
      }

      offset += 50;
      hasNextPage = items.length === 50;
    } catch (error) {
      console.error("[ERROR] Discography GraphQL failed:", error);
      break;
    }
  }

  discog.sort((a, b) => a.date.localeCompare(b.date));
  return discog;
}

type RawAlbumArtist = {
  uri?: string;
  profile?: { name?: string; uri?: string };
  data?: {
    uri?: string;
    profile?: { name?: string; uri?: string };
  };
};

type RawAlbumTrack = {
  duration?: { totalMilliseconds?: number };
  durationMs?: number;
  duration_ms?: number;
  uri?: string;
  name?: string;
  trackNumber?: number;
  track_number?: number;
  artists?: { items?: RawAlbumArtist[] } | RawAlbumArtist[];
};

function getDurationMs(track: RawAlbumTrack): number | null {
  const raw =
    track?.duration?.totalMilliseconds ??
    track?.durationMs ??
    track?.duration_ms;
  if (typeof raw === "number" && !Number.isNaN(raw) && raw > 0) return raw;
  return null;
}

function extractTrackArtists(
  track: RawAlbumTrack,
): { uri: string; name: string }[] {
  const rawArtists = track.artists;
  const items = Array.isArray(rawArtists)
    ? rawArtists
    : (rawArtists?.items ?? []);
  const artists: { uri: string; name: string }[] = [];
  for (const entry of items) {
    const artist = entry?.data ?? entry;
    const uri = artist?.uri ?? artist?.profile?.uri ?? "";
    const name = artist?.profile?.name?.trim?.() ?? "";
    if (!name && !uri) continue;
    artists.push({ uri, name: name || uri });
  }
  return artists;
}

function trackCreditsArtist(
  track: RawAlbumTrack,
  artistUri: string,
  artistId: string | null,
): boolean {
  const artists = extractTrackArtists(track);
  if (artists.length === 0) return true;
  return artists.some((artist) => {
    if (!artist.uri) return false;
    return artist.uri === artistUri || artist.uri.split(":").pop() === artistId;
  });
}

async function fetchAlbumTracks(
  album: ArtistAlbum,
  artistUri: string,
  artistId: string | null,
  queryAlbumTracks: unknown,
): Promise<ArtistTrack[]> {
  const albumTracks: ArtistTrack[] = [];
  let offset = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    try {
      const { data, errors } = await Spicetify.GraphQL.Request(
        queryAlbumTracks,
        {
          uri: `spotify:album:${album.id}`,
          offset,
          limit: 50,
        },
      );

      if (errors) throw new Error(errors[0]?.message || "GraphQL error");

      const items =
        data?.albumUnion?.tracksV2?.items ||
        data?.albumUnion?.tracks?.items ||
        [];
      if (!items.length) break;

      for (const item of items) {
        const track = (item.track || item) as RawAlbumTrack;
        const trackId = track.uri ? track.uri.split(":").pop() : null;
        if (!trackId || !trackCreditsArtist(track, artistUri, artistId))
          continue;

        const durationMs = getDurationMs(track);
        if (!durationMs) continue;

        albumTracks.push({
          id: trackId,
          name: track.name ?? "",
          uri: track.uri ?? "",
          albumId: album.id,
          albumName: album.name,
          trackNumber: track.trackNumber || track.track_number || 0,
          durationMs,
          artists: extractTrackArtists(track),
        });
      }

      offset += items.length;
      hasNextPage = items.length === 50;
    } catch (error) {
      console.error(`[ERROR] GraphQL failed for album ${album.id}:`, error);
      break;
    }
  }

  return albumTracks;
}

export async function getTracksFromDiscography(
  discography: ArtistAlbum[],
  artistUri: string,
): Promise<ArtistTrack[]> {
  const artistId = getArtistIdFromUri(artistUri);
  const queryAlbumTracks = Spicetify.GraphQL?.Definitions?.queryAlbumTracks;
  if (!queryAlbumTracks || discography.length === 0) return [];

  const tracks: ArtistTrack[] = [];
  const seenTrackIds = new Set<string>();

  for (let i = 0; i < discography.length; i += ALBUM_FETCH_CONCURRENCY) {
    const chunk = discography.slice(i, i + ALBUM_FETCH_CONCURRENCY);
    const batches = await Promise.all(
      chunk.map((album) =>
        fetchAlbumTracks(album, artistUri, artistId, queryAlbumTracks),
      ),
    );
    for (const batch of batches) {
      for (const track of batch) {
        if (seenTrackIds.has(track.id)) continue;
        seenTrackIds.add(track.id);
        tracks.push(track);
      }
    }
  }

  return tracks;
}

export async function getArtistTracks(
  artistUri: string,
): Promise<ArtistTrack[]> {
  const artistId = getArtistIdFromUri(artistUri);
  if (!artistId) return [];
  try {
    const discography = await getArtistDiscography(artistId);
    return await getTracksFromDiscography(discography, artistUri);
  } catch (error) {
    console.error("[ERROR] Failed to fetch artist tracks:", error);
    return [];
  }
}

export type SearchedTrack = {
  uri: string;
  name: string;
  artists: string[];
  albumName: string;
  durationMs: number | null;
};

function parseSearchTrackItems(response: unknown): SearchedTrack[] {
  const data = (response as { data?: Record<string, unknown> })?.data;
  const searchV2 = (data?.searchV2 ?? data?.search) as
    | Record<string, unknown>
    | undefined;
  if (!searchV2) return [];

  const tracksBlock = (searchV2.tracksV2 ?? searchV2.tracks) as
    | { items?: unknown[] }
    | undefined;
  const items = tracksBlock?.items ?? [];
  const results: SearchedTrack[] = [];

  for (const item of items) {
    const row = item as Record<string, unknown>;
    const nested = (row.item as Record<string, unknown> | undefined)?.data;
    const trackData = (nested ?? row.data ?? row) as Record<string, unknown>;

    const uri = typeof trackData.uri === "string" ? trackData.uri : "";
    if (!uri.startsWith("spotify:track:")) continue;

    const name = typeof trackData.name === "string" ? trackData.name : "";
    const artistsBlock = trackData.artists as
      | { items?: Array<{ profile?: { name?: string } }> }
      | Array<{ name?: string; profile?: { name?: string } }>
      | undefined;

    let artists: string[] = [];
    if (Array.isArray(artistsBlock)) {
      artists = artistsBlock
        .map((a) => a.profile?.name ?? a.name ?? "")
        .filter(Boolean);
    } else if (artistsBlock?.items) {
      artists = artistsBlock.items
        .map((a) => a.profile?.name ?? "")
        .filter(Boolean);
    }

    const albumOfTrack = trackData.albumOfTrack as
      | { name?: string }
      | undefined;
    const album = trackData.album as { name?: string } | undefined;
    const albumName = albumOfTrack?.name ?? album?.name ?? "";

    const duration = trackData.duration as
      | { totalMilliseconds?: number }
      | undefined;
    const durationMs =
      typeof duration?.totalMilliseconds === "number"
        ? duration.totalMilliseconds
        : null;

    results.push({ uri, name, artists, albumName, durationMs });
  }

  return results;
}

export async function searchTracks(
  query: string,
  limit = 10,
): Promise<SearchedTrack[]> {
  const term = query.trim();
  if (!term) return [];

  const defs = Spicetify.GraphQL.Definitions ?? {};
  const candidates: Array<{ def: unknown; vars: Record<string, unknown> }> = [];

  if (defs.searchDesktop) {
    candidates.push({
      def: defs.searchDesktop,
      vars: {
        searchTerm: term,
        offset: 0,
        limit,
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includeArtistHasConcertsField: false,
        includePreReleases: false,
        includeLocalConcertsField: false,
      },
    });
  }

  if (defs.assistedCurationSearch) {
    candidates.push({
      def: defs.assistedCurationSearch,
      vars: {
        term,
        limit,
        numberOfTopResults: limit,
      },
    });
  }

  if (defs.searchModalResults) {
    candidates.push({
      def: defs.searchModalResults,
      vars: {
        searchTerm: term,
        offset: 0,
        limit,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      },
    });
  }

  for (const { def, vars } of candidates) {
    try {
      const response = await Spicetify.GraphQL.Request(def, vars);
      const parsed = parseSearchTrackItems(response);
      if (parsed.length > 0) return parsed;
    } catch (error) {
      console.warn("[WARN] Track search failed:", error);
    }
  }

  return [];
}
