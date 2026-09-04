import { getArtistIdFromUri } from "@/operations/normalize";
import type { ArtistAlbum, ArtistTrack } from "@/operations/types";
import { ALBUM_FETCH_CONCURRENCY } from "@/operations/types";

const MAX_GQL = 2;
const GQL_RETRIES = 5;
let gqlActive = 0;
const gqlWaiters: Array<() => void> = [];

function acquireGql(): Promise<void> {
  if (gqlActive < MAX_GQL) {
    gqlActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    gqlWaiters.push(() => {
      gqlActive += 1;
      resolve();
    });
  });
}

function releaseGql() {
  gqlActive -= 1;
  gqlWaiters.shift()?.();
}

function isRateLimited(error: unknown): boolean {
  const err = error as {
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const status = err?.status ?? err?.statusCode;
  if (status === 429) return true;
  return /429|Too Many Requests/i.test(String(err?.message ?? error));
}

async function graphqlRequest(
  def: unknown,
  variables: Record<string, unknown>,
): Promise<any> {
  await acquireGql();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < GQL_RETRIES; attempt++) {
      try {
        return await Spicetify.GraphQL.Request(def, variables);
      } catch (error) {
        lastError = error;
        if (!isRateLimited(error) || attempt === GQL_RETRIES - 1) throw error;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastError;
  } finally {
    releaseGql();
  }
}

export type ArtistSearchHit = { uri: string; name: string };

export function pickArtistUri(
  hits: ArtistSearchHit[],
  artistName: string,
): string | null {
  const q = artistName.trim().toLowerCase();
  const exact = hits.find((h) => h.name.trim().toLowerCase() === q);
  return exact?.uri ?? hits[0]?.uri ?? null;
}

function artistHitsFromSearch(response: unknown): ArtistSearchHit[] {
  const hits: ArtistSearchHit[] = [];
  const seen = new Set<string>();
  const push = (uri: unknown, name: unknown) => {
    if (typeof uri !== "string" || !uri.startsWith("spotify:artist:")) return;
    if (seen.has(uri)) return;
    seen.add(uri);
    hits.push({
      uri,
      name: typeof name === "string" ? name : "",
    });
  };

  const data = (response as { data?: Record<string, unknown> })?.data;
  const search = (data?.searchV2 ?? data?.search) as
    | Record<string, unknown>
    | undefined;

  for (const entry of (search?.topResultsV2 as { itemsV2?: unknown[] })
    ?.itemsV2 ?? []) {
    const row = entry as Record<string, unknown>;
    const d = ((row.item as Record<string, unknown> | undefined)?.data ??
      row.data ??
      row) as Record<string, unknown>;
    const profile = d.profile as { name?: string } | undefined;
    push(d.uri, profile?.name ?? d.name);
  }
  for (const item of (search?.artists as { items?: unknown[] })?.items ?? []) {
    const row = item as Record<string, unknown>;
    const d = (row.data ?? row) as Record<string, unknown>;
    const profile = d.profile as { name?: string } | undefined;
    push(d.uri, profile?.name ?? d.name);
  }
  return hits;
}

export async function searchArtist(artistName: string): Promise<string | null> {
  const def = Spicetify.GraphQL.Definitions?.assistedCurationSearch;
  if (!def) {
    console.warn("[WARN] assistedCurationSearch definition missing");
    return null;
  }

  try {
    const response = await graphqlRequest(def, {
      term: artistName,
      limit: 10,
      numberOfTopResults: 10,
    });
    return pickArtistUri(artistHitsFromSearch(response), artistName);
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
    Spicetify.GraphQL.Definitions?.queryArtistDiscographyAll;
  if (!artistAlbumQuery) {
    throw new Error("queryArtistDiscographyAll unavailable");
  }

  while (hasNextPage) {
    const response = await graphqlRequest(artistAlbumQuery, {
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
          date: release.date?.isoString || release.date?.year?.toString() || "",
          albumType: release.type || "album",
        });
        seenAlbumIds.add(release.id);
      }
    }

    offset += 50;
    hasNextPage = items.length === 50;
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
  artistUri: string | null,
  artistId: string | null,
  queryAlbumTracks: unknown,
): Promise<ArtistTrack[]> {
  const albumTracks: ArtistTrack[] = [];
  let offset = 0;
  let hasNextPage = true;
  const albumUri = album.id.startsWith("spotify:album:")
    ? album.id
    : `spotify:album:${album.id}`;

  while (hasNextPage) {
    const { data, errors } = await graphqlRequest(queryAlbumTracks, {
      uri: albumUri,
      offset,
      limit: 50,
    });

    if (errors) throw new Error(errors[0]?.message || "GraphQL error");

    const items =
      data?.albumUnion?.tracksV2?.items ||
      data?.albumUnion?.tracks?.items ||
      [];
    if (!items.length) break;

    for (const item of items) {
      const track = (item.track || item) as RawAlbumTrack;
      const trackId = track.uri ? track.uri.split(":").pop() : null;
      if (!trackId) continue;
      if (artistUri && !trackCreditsArtist(track, artistUri, artistId)) {
        continue;
      }

      const durationMs = getDurationMs(track);
      if (!durationMs) continue;

      const albumId = album.id.includes(":")
        ? (album.id.split(":").pop() ?? album.id)
        : album.id;

      albumTracks.push({
        id: trackId,
        name: track.name ?? "",
        uri: track.uri ?? "",
        albumId,
        albumName: album.name,
        trackNumber: track.trackNumber || track.track_number || 0,
        durationMs,
        artists: extractTrackArtists(track),
      });
    }

    offset += items.length;
    hasNextPage = items.length === 50;
  }

  return albumTracks;
}

/** All tracks on an album (no artist-credit filter). */
export async function getAlbumTracks(
  albumUri: string,
  albumName = "",
): Promise<ArtistTrack[]> {
  const queryAlbumTracks = Spicetify.GraphQL?.Definitions?.queryAlbumTracks;
  if (!queryAlbumTracks) {
    throw new Error("queryAlbumTracks unavailable");
  }
  const id = albumUri.startsWith("spotify:album:")
    ? (albumUri.split(":").pop() ?? albumUri)
    : albumUri;
  return fetchAlbumTracks(
    { id, name: albumName, date: "", albumType: "" },
    null,
    null,
    queryAlbumTracks,
  );
}

export type WhatsNewAlbum = {
  feedItemId: string;
  uri: string;
  name: string;
  albumType: string;
  timestamp: string;
  artists: { uri: string; name: string }[];
};

export async function fetchWhatsNewFeed(
  signal?: AbortSignal,
): Promise<WhatsNewAlbum[]> {
  const def = Spicetify.GraphQL.Definitions?.queryWhatsNewFeed;
  if (!def) {
    throw new Error("queryWhatsNewFeed unavailable");
  }

  const albums: WhatsNewAlbum[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const limit = 50;

  while (true) {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    const response = await graphqlRequest(def, {
      offset,
      limit,
      onlyUnPlayedItems: false,
      includedContentTypes: [],
      includeEpisodeContentRatingsV2: true,
    });

    const feed = response?.data?.whatsNewFeedItems;
    const items = feed?.items ?? [];
    if (!items.length) break;

    for (const item of items) {
      const wrapper = item?.content;
      const data = wrapper?.data ?? wrapper;
      if (data?.__typename !== "Album") continue;
      const uri = typeof data.uri === "string" ? data.uri : "";
      if (!uri.startsWith("spotify:album:") || seen.has(uri)) continue;
      seen.add(uri);

      const artistItems = data.artists?.items ?? [];
      const artists: { uri: string; name: string }[] = [];
      for (const entry of artistItems) {
        const aUri = typeof entry?.uri === "string" ? entry.uri : "";
        const name = entry?.profile?.name?.trim?.() ?? "";
        if (!aUri && !name) continue;
        artists.push({ uri: aUri, name: name || aUri });
      }

      const feedItemId = typeof item?.id === "string" ? item.id : "";

      albums.push({
        feedItemId,
        uri,
        name: typeof data.name === "string" ? data.name : "",
        albumType: typeof data.albumType === "string" ? data.albumType : "",
        timestamp: item?.timestamp?.isoString ?? data?.date?.isoString ?? "",
        artists,
      });
    }

    const nextOffset = feed?.pagingInfo?.nextOffset;
    if (typeof nextOffset !== "number" || nextOffset <= offset) break;
    offset = nextOffset;
  }

  return albums;
}

function graphqlVariableNames(def: unknown): string[] {
  const doc = def as {
    definitions?: Array<{
      variableDefinitions?: Array<{
        variable?: { name?: { value?: string } };
      }>;
    }>;
  };
  const names: string[] = [];
  for (const op of doc?.definitions ?? []) {
    for (const v of op?.variableDefinitions ?? []) {
      const name = v?.variable?.name?.value;
      if (typeof name === "string" && name) names.push(name);
    }
  }
  return names;
}

function seenMutationVariableCandidates(
  ids: string[],
  varNames: string[],
): Record<string, unknown>[] {
  const has = (n: string) => varNames.length === 0 || varNames.includes(n);
  const candidates: Record<string, unknown>[] = [];

  if (has("inputs")) {
    candidates.push({
      inputs: ids.map((id) => ({ id, state: "SEEN" })),
    });
  }
  if (has("items")) {
    candidates.push({
      items: ids.map((id) => ({ id, state: "SEEN" })),
    });
  }
  if (has("ids") && has("state")) {
    candidates.push({ ids, state: "SEEN" });
  }
  if (has("itemIds") && has("state")) {
    candidates.push({ itemIds: ids, state: "SEEN" });
  }
  // Fallbacks when we can't read variableDefinitions
  if (candidates.length === 0) {
    candidates.push(
      { inputs: ids.map((id) => ({ id, state: "SEEN" })) },
      { items: ids.map((id) => ({ id, state: "SEEN" })) },
      { ids, state: "SEEN" },
    );
  }
  return candidates;
}

/** Mark What's New feed items as SEEN. Soft-fails on errors. */
export async function markWhatsNewItemsSeen(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) return;

  const def = Spicetify.GraphQL.Definitions?.SetItemsStateInWhatsNewFeed;
  if (!def) {
    console.warn("[WARN] SetItemsStateInWhatsNewFeed unavailable");
    return;
  }

  const varNames = graphqlVariableNames(def);
  const batchSize = 50;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const candidates = seenMutationVariableCandidates(batch, varNames);
    let ok = false;
    let lastError: unknown;
    for (const vars of candidates) {
      try {
        await graphqlRequest(def, vars);
        ok = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!ok) {
      console.warn(
        "[WARN] Failed to mark What's New items SEEN:",
        lastError,
        varNames.length ? `vars=${varNames.join(",")}` : "",
      );
    }
  }
}

export async function getTracksFromDiscography(
  discography: ArtistAlbum[],
  artistUri: string,
): Promise<ArtistTrack[]> {
  const artistId = getArtistIdFromUri(artistUri);
  const queryAlbumTracks = Spicetify.GraphQL?.Definitions?.queryAlbumTracks;
  if (!queryAlbumTracks) {
    throw new Error("queryAlbumTracks unavailable");
  }
  if (discography.length === 0) return [];

  const tracks: ArtistTrack[] = [];
  const seenTrackIds = new Set<string>();

  for (let i = 0; i < discography.length; i += ALBUM_FETCH_CONCURRENCY) {
    const chunk = discography.slice(i, i + ALBUM_FETCH_CONCURRENCY);
    const batches = await Promise.all(
      chunk.map(async (album) => {
        try {
          return await fetchAlbumTracks(
            album,
            artistUri,
            artistId,
            queryAlbumTracks,
          );
        } catch (error) {
          console.warn(
            `[WARN] Album tracks failed for ${album.name || album.id}:`,
            error,
          );
          return [] as ArtistTrack[];
        }
      }),
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
  if (!artistId) throw new Error(`Invalid artist URI: ${artistUri}`);
  const discography = await getArtistDiscography(artistId);
  return getTracksFromDiscography(discography, artistUri);
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
      const response = await graphqlRequest(def, vars);
      const parsed = parseSearchTrackItems(response);
      if (parsed.length > 0) return parsed;
    } catch (error) {
      console.warn("[WARN] Track search failed:", error);
    }
  }

  return [];
}
