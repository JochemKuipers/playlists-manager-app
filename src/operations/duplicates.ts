import { isDurationWithinRange, normalizeTrackName } from "./normalize";
import type { DuplicateGroup, PlaylistTrack } from "./types";

export function findDuplicates(tracks: PlaylistTrack[]): DuplicateGroup[] {
  if (!tracks.length) return [];

  const byName = new Map<string, PlaylistTrack[]>();
  for (const track of tracks) {
    const key = normalizeTrackName(track.name);
    const list = byName.get(key) ?? [];
    list.push(track);
    byName.set(key, list);
  }

  const grouped: DuplicateGroup[] = [];
  for (const groupTracks of byName.values()) {
    if (groupTracks.length > 1) {
      grouped.push({
        tracks: groupTracks,
        displayName: groupTracks[0].name,
        displayArtist: groupTracks[0].artists.join(", "),
        displayImage: groupTracks[0].albumImageUrl,
      });
    }
  }

  return findExactDuplicates(grouped);
}

function findExactDuplicates(
  duplicatesGrouped: DuplicateGroup[],
): DuplicateGroup[] {
  const result: DuplicateGroup[] = [];

  for (const group of duplicatesGrouped) {
    const byArtists = new Map<string, PlaylistTrack[]>();
    for (const track of group.tracks) {
      const artistKey = track.artists
        .map((a) => a.toLowerCase())
        .sort()
        .join(",");
      const list = byArtists.get(artistKey) ?? [];
      list.push(track);
      byArtists.set(artistKey, list);
    }

    for (const artistTracks of byArtists.values()) {
      if (artistTracks.length <= 1) continue;

      const durationGroups: PlaylistTrack[][] = [];
      for (const track of artistTracks) {
        let added = false;
        for (const durationGroup of durationGroups) {
          if (
            isDurationWithinRange(track.durationMs, durationGroup[0].durationMs)
          ) {
            durationGroup.push(track);
            added = true;
            break;
          }
        }
        if (!added) durationGroups.push([track]);
      }

      for (const durationGroup of durationGroups) {
        if (durationGroup.length > 1) {
          result.push({
            tracks: durationGroup,
            displayName: durationGroup[0].name,
            displayArtist: durationGroup[0].artists.join(", "),
            displayImage: durationGroup[0].albumImageUrl,
          });
        }
      }
    }
  }

  return result;
}

export function getTrackToKeepIndex(group: DuplicateGroup): number {
  let indexToKeep = 0;

  const hasLocal = group.tracks.some((t) => t.isLocal);
  const hasSpotify = group.tracks.some((t) => !t.isLocal);

  if (hasLocal && hasSpotify) {
    const spotifyIndex = group.tracks.findIndex((t) => !t.isLocal);
    if (spotifyIndex !== -1) indexToKeep = spotifyIndex;
  }

  const spotifyTracks = group.tracks.filter((t) => !t.isLocal);
  if (spotifyTracks.length > 0) {
    const hasExplicit = spotifyTracks.some((t) => t.isExplicit);
    const allExplicit = spotifyTracks.every((t) => t.isExplicit);
    if (hasExplicit && !allExplicit) {
      const explicitIndex = group.tracks.findIndex(
        (t) => !t.isLocal && t.isExplicit,
      );
      if (explicitIndex !== -1) indexToKeep = explicitIndex;
    }
  }

  return indexToKeep;
}
