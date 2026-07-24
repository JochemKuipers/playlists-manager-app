import { type SearchedTrack, searchTracks } from "@/api/graphql";
import { normalizeTrackName } from "@/operations/normalize";
import { ALBUM_FETCH_CONCURRENCY } from "@/operations/types";
import type { IgnoreSettings } from "@/settings";

export type CreditArtist = { name: string; uri?: string };

export type FilterableTrack = {
  name: string;
  albumName?: string;
  artists: Array<string | CreditArtist>;
  durationMs?: number | null;
  uri?: string;
};

export type OriginalTrack = {
  name: string;
  artists: string[];
  uri: string;
  durationMs: number | null;
};

export type JunkCategory = "live" | "sped" | "remix" | "custom";

export type JunkVerdict = {
  junk: boolean;
  reason: string;
  category: JunkCategory | null;
  original: OriginalTrack | null;
};

export type CompiledPattern = {
  source: string;
  regex: RegExp;
};

const PATTERN_WARN_LENGTH = 200;

const LIVE_RE =
  /\b(live(\s+(at|from|in|on|version|recording|session|performance))?|recorded\s+live|live\s+version)\b/i;
const LIVE_PAREN_RE = /[([\-–—]\s*live\b/i;

const SPED_RE =
  /\b(sped\s*up|speed\s*up|slowed(\s*(\+|&|and)\s*reverb)?|slowed\s*down|nightcore|daycore|super\s*slowed)\b/i;

const REMIX_WITH_NAME_RE =
  /(?:[([]\s*|[-–—]\s*|^|\s)(.+?)\s+(?:official\s+)?(?:remix|bootleg|edit|flip|mashup)\s*[)\]]?\s*$/i;
const REMIX_BARE_RE =
  /(?:[([]\s*|[-–—]\s*)(?:official\s+)?(?:remix|remixed|bootleg|edit)\s*[)\]]?\s*$/i;
const REMIXED_BY_RE = /\bremixed\s+by\s+(.+?)(?:\s*[)\]])?\s*$/i;

export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function artistNamesMatch(a: string, b: string): boolean {
  const na = normalizeArtistName(a);
  const nb = normalizeArtistName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function creditNames(artists: FilterableTrack["artists"]): string[] {
  return artists
    .map((a) => (typeof a === "string" ? a : a.name))
    .map((n) => n.trim())
    .filter(Boolean);
}

export function isLiveVersion(title: string, albumName = ""): boolean {
  const hay = `${title} ${albumName}`.trim();
  if (!hay) return false;
  // Avoid matching "Alive", "Olive", etc. via paren/dash forms + word-ish live phrases
  return LIVE_PAREN_RE.test(hay) || LIVE_RE.test(hay);
}

export function isSpedOrSlowed(title: string, albumName = ""): boolean {
  const hay = `${title} ${albumName}`.trim();
  return Boolean(hay) && SPED_RE.test(hay);
}

export function isRemixTitle(title: string): boolean {
  return (
    REMIXED_BY_RE.test(title) ||
    REMIX_WITH_NAME_RE.test(title) ||
    REMIX_BARE_RE.test(title) ||
    /\bremix(ed)?\b/i.test(title)
  );
}

export function parseRemixerName(title: string): string | null {
  const by = title.match(REMIXED_BY_RE);
  if (by?.[1]) return by[1].trim();

  const named = title.match(REMIX_WITH_NAME_RE);
  if (named?.[1]) {
    const candidate = named[1]
      .replace(/^(?:official|radio|club|extended|vip)\s+/i, "")
      .trim();
    // Bare "Remix" capture often picks trailing junk; reject empty / "the"
    if (
      candidate &&
      !/^(remix|remixed|bootleg|edit|flip|mashup)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function stripRemixSuffix(title: string): string {
  let cleaned = title;
  cleaned = cleaned.replace(REMIXED_BY_RE, "");
  cleaned = cleaned.replace(
    /\s*[([]\s*.+?\s+(?:official\s+)?(?:remix|bootleg|edit|flip|mashup)\s*[)\]]\s*$/i,
    "",
  );
  cleaned = cleaned.replace(
    /\s*[-–—]\s*.+?\s+(?:official\s+)?(?:remix|bootleg|edit|flip|mashup)\s*$/i,
    "",
  );
  cleaned = cleaned.replace(
    /\s*[([]\s*(?:official\s+)?(?:remix|remixed|bootleg|edit)\s*[)\]]\s*$/i,
    "",
  );
  cleaned = cleaned.replace(
    /\s*[-–—]\s*(?:official\s+)?(?:remix|remixed|bootleg|edit)\s*$/i,
    "",
  );
  return cleaned.replace(/\s+/g, " ").trim() || title.trim();
}

export function validatePattern(source: string): {
  ok: boolean;
  error?: string;
  warn?: string;
} {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "Empty pattern" };
  try {
    void new RegExp(trimmed, "i");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid regex",
    };
  }
  if (trimmed.length > PATTERN_WARN_LENGTH) {
    return {
      ok: true,
      warn: `Long pattern (${trimmed.length} chars) — may be slow`,
    };
  }
  return { ok: true };
}

export function compilePatterns(patterns: string[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const source of patterns) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    const check = validatePattern(trimmed);
    if (!check.ok) continue;
    try {
      out.push({ source: trimmed, regex: new RegExp(trimmed, "i") });
    } catch {
      // already validated; skip if somehow fails
    }
  }
  return out;
}

export function matchCustomPatterns(
  title: string,
  albumName: string,
  compiled: CompiledPattern[],
): string[] {
  const hits: string[] = [];
  for (const { source, regex } of compiled) {
    if (regex.test(title) || (albumName && regex.test(albumName))) {
      hits.push(source);
    }
  }
  return hits;
}

export function createOriginalCache(): Map<string, OriginalTrack | null> {
  return new Map();
}

function cacheKey(cleanedTitle: string, artists: string[]): string {
  const artistKey = artists
    .map(normalizeArtistName)
    .filter(Boolean)
    .sort()
    .join("|");
  return `${normalizeTrackName(cleanedTitle)}::${artistKey}`;
}

function artistOnCredits(owner: string, credits: string[]): boolean {
  return credits.some((c) => artistNamesMatch(owner, c));
}

function pickBestOriginal(
  results: SearchedTrack[],
  cleanedTitle: string,
  remixUri?: string,
): SearchedTrack | null {
  const normalizedTarget = normalizeTrackName(cleanedTitle);
  const candidates = results.filter((r) => {
    if (remixUri && r.uri === remixUri) return false;
    if (isRemixTitle(r.name)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const exact = candidates.find(
    (r) => normalizeTrackName(r.name) === normalizedTarget,
  );
  if (exact) return exact;

  const near = candidates.find((r) => {
    const n = normalizeTrackName(r.name);
    return n.includes(normalizedTarget) || normalizedTarget.includes(n);
  });
  return near ?? candidates[0];
}

export async function resolveOriginalTrack(
  remix: FilterableTrack,
  cache?: Map<string, OriginalTrack | null>,
): Promise<OriginalTrack | null> {
  const cleanedTitle = stripRemixSuffix(remix.name);
  const credits = creditNames(remix.artists);
  const remixer = parseRemixerName(remix.name);
  const searchArtists = credits.filter(
    (c) => !remixer || !artistNamesMatch(c, remixer),
  );
  const key = cacheKey(
    cleanedTitle,
    searchArtists.length > 0 ? searchArtists : credits,
  );

  if (cache?.has(key)) return cache.get(key) ?? null;

  const queryParts = [cleanedTitle, ...searchArtists.slice(0, 2)];
  const query = queryParts.join(" ").trim();
  const results = await searchTracks(query, 10);
  const best = pickBestOriginal(results, cleanedTitle, remix.uri);
  const resolved: OriginalTrack | null = best
    ? {
        name: best.name,
        artists: best.artists,
        uri: best.uri,
        durationMs: best.durationMs,
      }
    : null;

  cache?.set(key, resolved);
  return resolved;
}

async function evaluateRemixJunk(
  track: FilterableTrack,
  ownerArtists: string[],
  cache?: Map<string, OriginalTrack | null>,
): Promise<JunkVerdict> {
  const credits = creditNames(track.artists);
  const remixer = parseRemixerName(track.name);

  if (
    remixer &&
    ownerArtists.some((owner) => artistNamesMatch(owner, remixer))
  ) {
    return {
      junk: false,
      reason: "remixer is owner artist",
      category: "remix",
      original: null,
    };
  }

  const original = await resolveOriginalTrack(track, cache);

  if (original) {
    const ownersOnlyOnRemix = ownerArtists.filter(
      (owner) =>
        artistOnCredits(owner, credits) &&
        !artistOnCredits(owner, original.artists),
    );
    if (ownersOnlyOnRemix.length > 0) {
      return {
        junk: false,
        reason: "owner only on remix",
        category: "remix",
        original,
      };
    }

    const ownersOnOriginal = ownerArtists.filter((owner) =>
      artistOnCredits(owner, original.artists),
    );
    if (
      ownersOnOriginal.length > 0 &&
      (!remixer ||
        !ownersOnOriginal.some((owner) => artistNamesMatch(owner, remixer)))
    ) {
      return {
        junk: true,
        reason: "owner on original + foreign remixer",
        category: "remix",
        original,
      };
    }

    return {
      junk: false,
      reason: "remix kept after original compare",
      category: "remix",
      original,
    };
  }

  // Fallback: junk if owner is lead on remix and remixer ≠ owner
  const lead = credits[0];
  if (
    lead &&
    ownerArtists.some((owner) => artistNamesMatch(owner, lead)) &&
    remixer &&
    !ownerArtists.some((owner) => artistNamesMatch(owner, remixer))
  ) {
    return {
      junk: true,
      reason: "fallback: lead + foreign remixer",
      category: "remix",
      original: null,
    };
  }

  return {
    junk: false,
    reason: "fallback: keep remix",
    category: "remix",
    original: null,
  };
}

export async function evaluateJunkTrack(
  track: FilterableTrack,
  settings: IgnoreSettings,
  ownerArtists: string[],
  options?: {
    cache?: Map<string, OriginalTrack | null>;
    compiledPatterns?: CompiledPattern[];
  },
): Promise<JunkVerdict> {
  const album = track.albumName ?? "";
  const compiled =
    options?.compiledPatterns ?? compilePatterns(settings.customPatterns);

  if (settings.skipLive && isLiveVersion(track.name, album)) {
    return {
      junk: true,
      reason: "live version",
      category: "live",
      original: null,
    };
  }

  if (settings.skipSpedSlowed && isSpedOrSlowed(track.name, album)) {
    return {
      junk: true,
      reason: "sped/slowed version",
      category: "sped",
      original: null,
    };
  }

  const customHits = matchCustomPatterns(track.name, album, compiled);
  if (customHits.length > 0) {
    return {
      junk: true,
      reason: `custom pattern: ${customHits[0]}`,
      category: "custom",
      original: null,
    };
  }

  if (settings.skipDjRemixes && isRemixTitle(track.name)) {
    return evaluateRemixJunk(track, ownerArtists, options?.cache);
  }

  return {
    junk: false,
    reason: "no filter match",
    category: null,
    original: null,
  };
}

/** Local-only checks for the sample tester (no remix resolve). */
export function evaluateLocalFilters(
  title: string,
  albumName: string,
  settings: IgnoreSettings,
): {
  live: boolean;
  sped: boolean;
  customHits: string[];
  looksLikeRemix: boolean;
} {
  const compiled = compilePatterns(settings.customPatterns);
  return {
    live: isLiveVersion(title, albumName),
    sped: isSpedOrSlowed(title, albumName),
    customHits: matchCustomPatterns(title, albumName, compiled),
    looksLikeRemix: isRemixTitle(title),
  };
}

export async function mapInChunks<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  chunkSize = ALBUM_FETCH_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const batch = await Promise.all(
      slice.map((item, offset) => mapper(item, i + offset)),
    );
    for (let j = 0; j < batch.length; j++) results[i + j] = batch[j];
  }
  return results;
}
