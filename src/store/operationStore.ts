import type {
  ItemStatus,
  LogEvent,
  LogKind,
  OperationKind,
  OpResult,
  PlaylistCard,
  ProgressEvent,
  SelectionMode,
} from "@/operations/types";
import { LIKED_SONGS_URI } from "@/operations/types";

export type OperationState = {
  mode: SelectionMode;
  operation: OperationKind;
  playlists: PlaylistCard[];
  selected: Set<string>;
  statuses: Map<string, ItemStatus>;
  itemProgress: Map<string, number>;
  itemMessages: Map<string, string>;
  logs: LogEvent[];
  running: boolean;
  overallProgress: number;
  loadError: string | null;
  loadingPlaylists: boolean;
};

type Listener = () => void;

let logSeq = 0;
let abortController: AbortController | null = null;

// Mutable working state — never returned directly to React.
const data: OperationState = {
  mode: "all",
  operation: "clean",
  playlists: [],
  selected: new Set(),
  statuses: new Map(),
  itemProgress: new Map(),
  itemMessages: new Map(),
  logs: [],
  running: false,
  overallProgress: 0,
  loadError: null,
  loadingPlaylists: false,
};

// Stable snapshot for useSyncExternalStore (new ref on every emit).
let snapshot: OperationState = { ...data };

const listeners = new Set<Listener>();

function emit(): void {
  snapshot = {
    ...data,
    selected: data.selected,
    statuses: data.statuses,
    itemProgress: data.itemProgress,
    itemMessages: data.itemMessages,
    logs: data.logs,
    playlists: data.playlists,
  };
  for (const listener of listeners) listener();
}

export function getState(): OperationState {
  return snapshot;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function appendLog(
  message: string,
  kind: LogKind = "info",
  playlistUri?: string,
): void {
  logSeq += 1;
  data.logs = [
    ...data.logs,
    { id: String(logSeq), ts: Date.now(), kind, message, playlistUri },
  ].slice(-500);
  emit();
}

export function setMode(mode: SelectionMode): void {
  if (data.running) return;
  data.mode = mode;
  if (mode === "liked") {
    data.operation = "clean";
    data.selected = new Set([LIKED_SONGS_URI]);
  } else if (mode === "all") {
    data.selected = new Set(data.playlists.map((p) => p.uri));
  } else if (mode === "single" && data.selected.size > 1) {
    const first = data.selected.values().next().value;
    data.selected = first ? new Set([first]) : new Set();
  } else if (mode === "selection" && data.selected.has(LIKED_SONGS_URI)) {
    data.selected = new Set();
  }
  emit();
}

export function setOperation(operation: OperationKind): void {
  if (data.running) return;
  if (data.mode === "liked" && operation !== "clean") return;
  data.operation = operation;
  emit();
}

export function setPlaylists(playlists: PlaylistCard[]): void {
  data.playlists = playlists;
  data.loadingPlaylists = false;
  data.loadError = null;
  if (data.mode === "all") {
    data.selected = new Set(playlists.map((p) => p.uri));
  }
  const statuses = new Map<string, ItemStatus>();
  for (const p of playlists) statuses.set(p.uri, "idle");
  statuses.set(LIKED_SONGS_URI, "idle");
  data.statuses = statuses;
  emit();
}

export function setLoadingPlaylists(loading: boolean): void {
  data.loadingPlaylists = loading;
  emit();
}

export function setLoadError(error: string | null): void {
  data.loadError = error;
  data.loadingPlaylists = false;
  emit();
}

export function toggleSelect(uri: string): void {
  if (data.running) return;
  if (data.mode === "all" || data.mode === "liked") return;

  const next = new Set(data.selected);
  if (data.mode === "single") {
    data.selected = new Set([uri]);
  } else {
    if (next.has(uri)) next.delete(uri);
    else next.add(uri);
    data.selected = next;
  }
  emit();
}

export function beginRun(uris: string[]): AbortSignal {
  abortController?.abort();
  abortController = new AbortController();
  data.running = true;
  data.overallProgress = 0;
  data.logs = [];
  data.itemProgress = new Map();
  data.itemMessages = new Map();

  const statuses = new Map(data.statuses);
  for (const [uri] of statuses) statuses.set(uri, "idle");
  for (const uri of uris) statuses.set(uri, "idle");
  data.statuses = statuses;

  appendLog(`Starting ${data.operation} on ${uris.length} target(s)…`, "info");
  return abortController.signal;
}

export function handleProgress(event: ProgressEvent): void {
  if (event.playlistUri) {
    const messages = new Map(data.itemMessages);
    messages.set(event.playlistUri, event.message);
    data.itemMessages = messages;
    if (typeof event.progress === "number") {
      const progress = new Map(data.itemProgress);
      progress.set(event.playlistUri, event.progress);
      data.itemProgress = progress;
    }
  }
  appendLog(
    event.message,
    event.kind ?? "info",
    event.playlistUri || undefined,
  );
}

export function handleItemStart(uri: string): void {
  const statuses = new Map(data.statuses);
  statuses.set(uri, "running");
  data.statuses = statuses;
  const progress = new Map(data.itemProgress);
  progress.set(uri, 0);
  data.itemProgress = progress;
  emit();
}

export function handleItemDone(
  result: OpResult,
  total: number,
  doneCount: number,
): void {
  const statuses = new Map(data.statuses);
  statuses.set(
    result.playlistUri,
    result.aborted ? "skipped" : result.ok ? "done" : "failed",
  );
  data.statuses = statuses;

  const progress = new Map(data.itemProgress);
  progress.set(result.playlistUri, 1);
  data.itemProgress = progress;

  const messages = new Map(data.itemMessages);
  messages.set(result.playlistUri, result.message);
  data.itemMessages = messages;

  data.overallProgress = total === 0 ? 1 : doneCount / total;
  appendLog(
    result.message,
    result.ok ? "success" : result.aborted ? "skip" : "error",
    result.playlistUri,
  );
}

export function endRun(summary: string): void {
  data.running = false;
  data.overallProgress = 1;
  abortController = null;
  appendLog(summary, "success");
}

export function requestStop(): void {
  abortController?.abort();
  appendLog("Stop requested — finishing in-flight steps…", "skip");
}

export function getTargetUris(): string[] {
  if (data.mode === "liked") return [LIKED_SONGS_URI];
  if (data.mode === "all") return data.playlists.map((p) => p.uri);
  return [...data.selected];
}

export function clearLogs(): void {
  data.logs = [];
  emit();
}
