const CACHE_KEY = "playlist-manager-ai-artists";
const CACHE_TS_KEY = "playlist-manager-ai-artists-ts";
const TTL_MS = 24 * 60 * 60 * 1000;
const ZOUNDHUB_THRESHOLD = 80;

const SOUL_OVER_AI_URL =
  "https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json";
const CENNOXX_CSV_URL =
  "https://raw.githubusercontent.com/CennoxX/spotify-ai-blocker/main/SpotifyAiArtists.csv";
const ZOUNDHUB_URL = "https://zoundhub.com/api/artists/all";

const SPOTIFY_ID_RE = /^[0-9A-Za-z]{22}$/;

/** Extract Spotify artist ID from URL, URI, or bare id. */
export function extractArtistId(
  value: string | null | undefined,
): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (SPOTIFY_ID_RE.test(trimmed)) return trimmed;

  const uriMatch = trimmed.match(/spotify:artist:([0-9A-Za-z]{22})/);
  if (uriMatch?.[1]) return uriMatch[1];

  const urlMatch = trimmed.match(
    /open\.spotify\.com\/artist\/([0-9A-Za-z]{22})/,
  );
  if (urlMatch?.[1]) return urlMatch[1];

  return null;
}

export function parseSoulOverAiIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.removed === true) continue;
    const spotify =
      typeof record.spotify === "string"
        ? record.spotify
        : typeof record.spotifyId === "string"
          ? record.spotifyId
          : null;
    const id = extractArtistId(spotify);
    if (id) ids.push(id);
  }
  return ids;
}

export function parseCennoxCsv(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith("artist,")) continue;
    // artist,id — name may contain commas; id is last field
    const comma = trimmed.lastIndexOf(",");
    if (comma < 0) continue;
    const id = extractArtistId(trimmed.slice(comma + 1));
    if (id) ids.push(id);
  }
  return ids;
}

export function parseZoundhubIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const score = record.submithub_score;
    if (typeof score !== "number" || score < ZOUNDHUB_THRESHOLD) continue;
    const id = extractArtistId(
      typeof record.spotify_id === "string" ? record.spotify_id : null,
    );
    if (id) ids.push(id);
  }
  return ids;
}

function readCache(): Set<string> | null {
  try {
    const tsRaw = Spicetify.LocalStorage.get(CACHE_TS_KEY);
    const raw = Spicetify.LocalStorage.get(CACHE_KEY);
    if (!tsRaw || !raw) return null;
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || Date.now() - ts > TTL_MS) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return null;
  }
}

function writeCache(ids: Set<string>): void {
  try {
    Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify([...ids]));
    Spicetify.LocalStorage.set(CACHE_TS_KEY, String(Date.now()));
  } catch (error) {
    console.warn("[WARN] Failed to cache AI artist list:", error);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

/** Union of SoulOverAI + CennoxX + Zoundhub (≥80) artist IDs. */
export async function loadAiArtistIds(): Promise<Set<string>> {
  const cached = readCache();
  if (cached) return cached;

  const ids = new Set<string>();
  const results = await Promise.allSettled([
    fetchJson(SOUL_OVER_AI_URL).then(parseSoulOverAiIds),
    fetchText(CENNOXX_CSV_URL).then(parseCennoxCsv),
    fetchJson(ZOUNDHUB_URL).then(parseZoundhubIds),
  ]);

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const id of result.value) ids.add(id);
    } else {
      console.warn("[WARN] AI artist source failed:", result.reason);
    }
  }

  // Stale cache fallback when every live fetch failed
  if (ids.size === 0) {
    try {
      const raw = Spicetify.LocalStorage.get(CACHE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === "string") ids.add(id);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (ids.size > 0) writeCache(ids);
  return ids;
}

export function isAiArtist(
  artistId: string | null | undefined,
  aiIds: Set<string>,
): boolean {
  if (!artistId) return false;
  return aiIds.has(artistId);
}
