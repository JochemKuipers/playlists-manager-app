export type PlaylistTrack = {
  uri: string;
  name: string;
  durationMs: number;
  artists: string[];
  albumName?: string;
  isLocal: boolean;
  isExplicit: boolean;
  albumImageUrl?: string;
  index: number;
  uid?: string;
  rowId?: string;
};

export type DuplicateGroup = {
  tracks: PlaylistTrack[];
  displayName: string;
  displayArtist: string;
  displayImage?: string;
};

export type ArtistAlbum = {
  id: string;
  name: string;
  date: string;
  albumType: string;
};

export type ArtistTrack = {
  id: string;
  name: string;
  uri: string;
  albumId: string;
  albumName: string;
  trackNumber: number;
  durationMs: number;
  artists: { uri: string; name: string }[];
};

export type PlaylistCard = {
  uri: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  owned: boolean;
};

export type SelectionMode = "playlists" | "liked";
export type OperationKind = "update" | "clean" | "likeMissing";
export type ItemStatus = "idle" | "running" | "done" | "failed" | "skipped";

export type LogKind = "info" | "add" | "remove" | "skip" | "error" | "success";

export type LogEvent = {
  id: string;
  ts: number;
  kind: LogKind;
  message: string;
  playlistUri?: string;
};

export type ProgressEvent = {
  playlistUri: string;
  message: string;
  kind?: LogKind;
  progress?: number; // 0–1 within this playlist
};

export type OpResult = {
  playlistUri: string;
  ok: boolean;
  added?: number;
  removed?: number;
  liked?: number;
  message: string;
  aborted?: boolean;
};

export type LikedSongsIndex = {
  uris: Set<string>;
  byName: Map<string, Array<number | null>>;
  tracks: PlaylistTrack[];
};

export const DURATION_TOLERANCE_MS = 5000;
export const API_BATCH_SIZE = 50;
export const ALBUM_FETCH_CONCURRENCY = 12;

export const LIKED_SONGS_URI = "spotify:collection:tracks";
export const LIKED_SONGS_PLAYLIST_IDS = new Set(["37i9dQZF1F5p3rmiWPIYgZ"]);
