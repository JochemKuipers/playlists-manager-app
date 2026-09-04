import { describe, expect, test } from "bun:test";
import { getTrackToKeepIndex } from "./duplicates";
import { addDurationEntry, shouldSkipAddingTrack } from "./normalize";
import { isLiveVersion, isRemixTitle, validatePattern } from "./trackFilters";
import type { DuplicateGroup, PlaylistTrack } from "./types";

function track(
  partial: Partial<PlaylistTrack> & Pick<PlaylistTrack, "uri" | "name">,
): PlaylistTrack {
  return {
    durationMs: 200_000,
    artists: ["Artist"],
    isLocal: false,
    isExplicit: false,
    index: 0,
    ...partial,
  };
}

describe("getTrackToKeepIndex", () => {
  test("prefers explicit spotify over clean", () => {
    const group: DuplicateGroup = {
      displayName: "Song",
      displayArtist: "Artist",
      tracks: [
        track({
          uri: "spotify:track:a",
          name: "Song",
          isExplicit: false,
          index: 0,
        }),
        track({
          uri: "spotify:track:b",
          name: "Song",
          isExplicit: true,
          index: 1,
        }),
      ],
    };
    expect(getTrackToKeepIndex(group)).toBe(1);
  });
});

describe("shouldSkipAddingTrack", () => {
  test("skips when name and duration match", () => {
    const map = new Map<string, Array<number | null>>();
    addDurationEntry(map, "song", 200_000);
    expect(shouldSkipAddingTrack(map, "song", 201_000)).toBe(true);
    expect(shouldSkipAddingTrack(map, "song", 220_000)).toBe(false);
    expect(shouldSkipAddingTrack(map, "other", 200_000)).toBe(false);
  });
});

describe("trackFilters", () => {
  test("isRemixTitle detects remix suffix", () => {
    expect(isRemixTitle("Song (DJ Foo Remix)")).toBe(true);
    expect(isRemixTitle("I Want You - PatFromLastYear Remix")).toBe(true);
    expect(isRemixTitle("Song")).toBe(false);
  });

  test("validatePattern rejects overlong", () => {
    expect(validatePattern("a".repeat(81)).ok).toBe(false);
    expect(validatePattern("\\blive\\b").ok).toBe(true);
  });

  test("isLiveVersion ignores LIVE FOREVER studio titles", () => {
    expect(isLiveVersion("live forever", "LIVE FOREVER")).toBe(false);
    expect(isLiveVersion("angeldust", "LIVE FOREVER")).toBe(false);
    expect(isLiveVersion("Alive")).toBe(false);
  });

  test("isLiveVersion matches real live markers", () => {
    expect(isLiveVersion("Song (Live)")).toBe(true);
    expect(isLiveVersion("Song - Live")).toBe(true);
    expect(isLiveVersion("Live at Wembley")).toBe(true);
    expect(isLiveVersion("Song", "Live")).toBe(true);
    expect(isLiveVersion("Song", "Greatest Hits Live")).toBe(true);
  });
});
