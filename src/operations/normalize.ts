import { DURATION_TOLERANCE_MS } from "./types";

export function normalizeTrackName(name: string): string {
  let normalized = name.toLowerCase().trim();
  normalized = normalized.replace(/\s*[([].*?[)\]]/g, "");
  normalized = normalized.replace(
    /\s*-\s*(remaster(ed)?(\s*\d{2,4})?|live|mono|stereo|single version|radio edit).*$/i,
    "",
  );
  return normalized.replace(/\s+/g, " ").trim();
}

export function isDurationWithinRange(
  duration1: number | undefined,
  duration2: number | undefined,
): boolean {
  const d1 = Number.isFinite(duration1) ? Number(duration1) : null;
  const d2 = Number.isFinite(duration2) ? Number(duration2) : null;
  if (d1 === null || d2 === null) return false;
  return Math.abs(d1 - d2) <= DURATION_TOLERANCE_MS;
}

export function normalizeDuration(
  durationMs: number | undefined,
): number | null {
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    return durationMs;
  }
  return null;
}

export function hasDurationMatch(
  map: Map<string, Array<number | null>>,
  normalizedName: string,
  duration: number | null,
): boolean {
  const durations = map.get(normalizedName);
  if (!durations) return false;
  for (const existingDuration of durations) {
    if (existingDuration === null || duration === null) continue;
    if (Math.abs(existingDuration - duration) <= DURATION_TOLERANCE_MS)
      return true;
  }
  return false;
}

/** Same-name + duration (or name-only when either side lacks duration). */
export function shouldSkipAddingTrack(
  map: Map<string, Array<number | null>>,
  normalizedName: string,
  duration: number | null,
): boolean {
  const durations = map.get(normalizedName);
  if (!durations || durations.length === 0) return false;
  if (duration === null || durations.some((d) => d === null)) return true;
  return hasDurationMatch(map, normalizedName, duration);
}

export function addDurationEntry(
  map: Map<string, Array<number | null>>,
  normalizedName: string,
  duration: number | null,
): void {
  const durations = map.get(normalizedName) ?? [];
  durations.push(duration);
  map.set(normalizedName, durations);
}

export function parseArtistsFromTitle(title: string): string[] {
  return title
    .split(" / ")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function getPlaylistIdFromUri(uri: string): string | null {
  const match = uri.match(/playlist[/:]([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

export function getArtistIdFromUri(uri: string): string | null {
  return uri.split(":").pop() ?? null;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}
