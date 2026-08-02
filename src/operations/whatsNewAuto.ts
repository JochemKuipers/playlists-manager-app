import { loadWhatsNewAutoSettings } from "@/settings";
import { appendLog } from "@/store/operationStore";
import type { ProgressFn } from "./update";
import { syncWhatsNew } from "./whatsNew";

let timerId: ReturnType<typeof setInterval> | null = null;
let started = false;

const quietProgress: ProgressFn = (event) => {
  appendLog(
    event.message,
    event.kind ?? "info",
    event.playlistUri || undefined,
  );
};

export async function runWhatsNewAutoSync(
  reason: "startup" | "timer",
): Promise<void> {
  const settings = loadWhatsNewAutoSettings();
  if (!settings.enabled) return;

  appendLog(`What's New autosync (${reason})…`, "info");
  const result = await syncWhatsNew(quietProgress);

  if (result.aborted) {
    appendLog("What's New autosync aborted", "skip");
    return;
  }

  if (!result.ok) {
    // Busy lock is expected when a manual sync is running
    if (result.message.includes("already running")) {
      appendLog("What's New autosync skipped — sync already running", "skip");
      return;
    }
    appendLog(`What's New autosync failed: ${result.message}`, "error");
    Spicetify.showNotification("What's New autosync failed", true);
    return;
  }

  appendLog(result.message, "success");
  const liked = result.liked ?? 0;
  const added = result.added ?? 0;
  if (liked > 0 || added > 0) {
    Spicetify.showNotification(result.message);
  }
}

export function stopWhatsNewAutoSync(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  started = false;
}

/** Idempotent: restarts timer from current settings; runs startup sync when enabled. */
export function startWhatsNewAutoSync(): void {
  stopWhatsNewAutoSync();

  const settings = loadWhatsNewAutoSettings();
  if (!settings.enabled) return;

  started = true;
  void runWhatsNewAutoSync("startup");

  const ms = settings.intervalMinutes * 60_000;
  timerId = setInterval(() => {
    void runWhatsNewAutoSync("timer");
  }, ms);
}

export function isWhatsNewAutoSyncStarted(): boolean {
  return started;
}
