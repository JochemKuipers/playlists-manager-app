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

export type JunkCategory =
  | "live"
  | "sped"
  | "remix"
  | "instrumental"
  | "commentary"
  | "acapella"
  | "custom";

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

const INSTRUMENTAL_RE =
  /\b(instrumentals?|karaoke|inst\.?)\b/i;
const COMMENTARY_RE =
  /\b(commentary|interview|spoken\s*word|skit)\b/i;
const ACAPELLA_RE =
  /\b(a\s*c+ap+ella|acapellas?)\b/i;

const REMIX_PAREN_RE =
  /[([]([^()\]]+?)\s+(?:official\s+)?(?:remix|bootleg|edit|flip|mashup)\s*[)\]]\s*$/i;
const REMIX_DASH_RE =
  /\s*[-–—−‐‑‒―]\s*(.+?)\s+(?:official\s+)?(?:remix|bootleg|edit|flip|mashup)\s*$/i;
const REMIX_BARE_RE =
  /(?:[([]\s*|[-–—−‐‑‒―]\s*)(?:official\s+)?(?:remix|remixed|bootleg|edit)\s*[)\]]?\s*$/i;
const REMIXED_BY_RE = /\bremixed\s+by\s+(.+?)(?:\s*[)\]])?\s*$/i;

/** Normalize dashes/spaces so Spotify title quirks still match. */
export function normalizeTitleForRemix(title: string): string {
  return title
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[-–—−‐‑‒―]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact-ish match for remixer vs owner (avoid loose includes false positives). */
export function artistNamesEqual(a: string, b: string): boolean {
  const na = normalizeArtistName(a);
  const nb = normalizeArtistName(b);
  return Boolean(na && nb && na === nb);
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

export function isInstrumental(title: string, albumName = ""): boolean {
  const hay = `${title} ${albumName}`.trim();
  return Boolean(hay) && INSTRUMENTAL_RE.test(hay);
}

export function isCommentary(title: string, albumName = ""): boolean {
  const hay = `${title} ${albumName}`.trim();
  return Boolean(hay) && COMMENTARY_RE.test(hay);
}

export function isAcapella(title: string, albumName = ""): boolean {
  const hay = `${title} ${albumName}`.trim();
  return Boolean(hay) && ACAPELLA_RE.test(hay);
}

export function isRemixTitle(title: string): boolean {
  const t = normalizeTitleForRemix(title);
  return (
    REMIXED_BY_RE.test(t) ||
    REMIX_PAREN_RE.test(t) ||
    REMIX_DASH_RE.test(t) ||
    REMIX_BARE_RE.test(t) ||
    /\bremix(ed)?\b/i.test(t)
  );
}

function cleanRemixerCandidate(raw: string): string | null {
  const candidate = raw
    .replace(/^(?:official|radio|club|extended|vip)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !candidate ||
    /^(remix|remixed|bootleg|edit|flip|mashup|phonk)$/i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function parseRemixerName(title: string): string | null {
  const t = normalizeTitleForRemix(title);
  const by = t.match(REMIXED_BY_RE);
  if (by?.[1]) return cleanRemixerCandidate(by[1]);

  // Prefer (...) / [...] suffix so we don't swallow the song title
  const paren = t.match(REMIX_PAREN_RE);
  if (paren?.[1]) return cleanRemixerCandidate(paren[1]);

  const dash = t.match(REMIX_DASH_RE);
  if (dash?.[1]) return cleanRemixerCandidate(dash[1]);

  return null;
}

export function stripRemixSuffix(title: string): string {
  let cleaned = normalizeTitleForRemix(title);
  cleaned = cleaned.replace(REMIXED_BY_RE, "");
  cleaned = cleaned.replace(REMIX_PAREN_RE, "");
  cleaned = cleaned.replace(REMIX_DASH_RE, "");
  cleaned = cleaned.replace(REMIX_BARE_RE, "");
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
  ownerArtists: string[] = [],
): Promise<OriginalTrack | null> {
  const cleanedTitle = stripRemixSuffix(remix.name);
  const credits = creditNames(remix.artists);
  const remixer = parseRemixerName(remix.name);
  const fromCredits = credits.filter(
    (c) => !remixer || !artistNamesMatch(c, remixer),
  );
  // Prefer remix credits; fall back to playlist/owner artists for the search query
  const searchArtists =
    fromCredits.length > 0
      ? fromCredits
      : ownerArtists.filter(
          (o) => !remixer || !artistNamesMatch(o, remixer),
        );
  const key = cacheKey(cleanedTitle, searchArtists);

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

function isForeignRemixer(
  remixer: string | null,
  ownerArtists: string[],
): remixer is string {
  return Boolean(
    remixer &&
      !ownerArtists.some((owner) => artistNamesEqual(owner, remixer)),
  );
}

/** Remixer or another credited (non-owner) artist matches a followed artist. */
function followedWhitelistHit(
  remixer: string | null,
  credits: string[],
  ownerArtists: string[],
  followedArtists: string[],
): string | null {
  if (followedArtists.length === 0) return null;

  if (
    remixer &&
    followedArtists.some((followed) => artistNamesMatch(followed, remixer))
  ) {
    return remixer;
  }

  for (const credit of credits) {
    if (ownerArtists.some((owner) => artistNamesEqual(owner, credit))) continue;
    if (followedArtists.some((followed) => artistNamesMatch(followed, credit))) {
      return credit;
    }
  }

  return null;
}

async function evaluateRemixJunk(
  track: FilterableTrack,
  ownerArtists: string[],
  cache?: Map<string, OriginalTrack | null>,
  followedArtists: string[] = [],
): Promise<JunkVerdict> {
  const credits = creditNames(track.artists);
  const remixer = parseRemixerName(track.name);

  // Artist remixed someone else (their name is the remixer) → keep
  if (
    remixer &&
    ownerArtists.some((owner) => artistNamesEqual(owner, remixer))
  ) {
    return {
      junk: false,
      reason: "remixer is owner artist",
      category: "remix",
      original: null,
    };
  }

  // Followed remixer / co-artist → whitelist
  const followedHit = followedWhitelistHit(
    remixer,
    credits,
    ownerArtists,
    followedArtists,
  );
  if (followedHit) {
    return {
      junk: false,
      reason: `followed artist whitelist (${followedHit})`,
      category: "remix",
      original: null,
    };
  }

  // Named DJ in the title who isn't the playlist artist → always junk.
  // Must run before original lookup — a bad search used to hit "owner only on
  // remix" and keep CKDY/shryne/phonk remixes of the artist's own songs.
  if (isForeignRemixer(remixer, ownerArtists)) {
    return {
      junk: true,
      reason: `foreign remixer in title (${remixer})`,
      category: "remix",
      original: null,
    };
  }

  // Any remix title on an artist playlist with no keep reason above → junk.
  // Covers unnamed "(Remix)" and failed remixer parses.
  if (ownerArtists.length > 0) {
    return {
      junk: true,
      reason: remixer
        ? `remix filtered (${remixer})`
        : "remix title on artist playlist",
      category: "remix",
      original: null,
    };
  }

  // Liked Songs / no owners: use original compare + lead heuristic
  const original = await resolveOriginalTrack(track, cache, ownerArtists);

  if (original) {
    const lead = credits[0];
    if (
      lead &&
      artistOnCredits(lead, original.artists) &&
      isForeignRemixer(remixer, [lead])
    ) {
      return {
        junk: true,
        reason: "lead on original + foreign remixer",
        category: "remix",
        original,
      };
    }
    if (lead && !artistOnCredits(lead, original.artists)) {
      return {
        junk: false,
        reason: "lead only on remix",
        category: "remix",
        original,
      };
    }
  }

  if (remixer) {
    return {
      junk: true,
      reason: `fallback: named remixer (${remixer})`,
      category: "remix",
      original,
    };
  }

  return {
    junk: false,
    reason: "fallback: keep remix",
    category: "remix",
    original,
  };
}

export async function evaluateJunkTrack(
  track: FilterableTrack,
  settings: IgnoreSettings,
  ownerArtists: string[],
  options?: {
    cache?: Map<string, OriginalTrack | null>;
    compiledPatterns?: CompiledPattern[];
    followedArtists?: string[];
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

  if (settings.skipInstrumental && isInstrumental(track.name, album)) {
    return {
      junk: true,
      reason: "instrumental",
      category: "instrumental",
      original: null,
    };
  }

  if (settings.skipCommentary && isCommentary(track.name, album)) {
    return {
      junk: true,
      reason: "commentary",
      category: "commentary",
      original: null,
    };
  }

  if (settings.skipAcapella && isAcapella(track.name, album)) {
    return {
      junk: true,
      reason: "a cappella",
      category: "acapella",
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
    return evaluateRemixJunk(
      track,
      ownerArtists,
      options?.cache,
      options?.followedArtists ?? [],
    );
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
  instrumental: boolean;
  commentary: boolean;
  acapella: boolean;
  customHits: string[];
  looksLikeRemix: boolean;
} {
  const compiled = compilePatterns(settings.customPatterns);
  return {
    live: isLiveVersion(title, albumName),
    sped: isSpedOrSlowed(title, albumName),
    instrumental: isInstrumental(title, albumName),
    commentary: isCommentary(title, albumName),
    acapella: isAcapella(title, albumName),
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
