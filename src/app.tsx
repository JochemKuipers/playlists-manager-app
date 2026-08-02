import React, { useEffect } from "react";
import { listOwnedPlaylists } from "@/api/rootlist";
import { LogStream } from "@/components/LogStream";
import { ModePicker } from "@/components/ModePicker";
import { OpControls } from "@/components/OpControls";
import { PlaylistGrid } from "@/components/PlaylistGrid";
import { ProgressPanel } from "@/components/ProgressPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { runBatch } from "@/operations/batch";
import type { OperationKind } from "@/operations/types";
import {
  beginRun,
  endRun,
  getTargetUris,
  handleItemDone,
  handleItemStart,
  handleProgress,
  setLoadError,
  setLoadingPlaylists,
  setPlaylists,
} from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "./css/app.module.scss";

async function loadPlaylists() {
  setLoadingPlaylists(true);
  try {
    const cards = await listOwnedPlaylists();
    setPlaylists(cards);
  } catch (error) {
    console.error(error);
    setLoadError(
      error instanceof Error ? error.message : "Failed to load playlists",
    );
  }
}

async function startOperation(operation: OperationKind) {
  const uris = getTargetUris();
  if (uris.length === 0) return;

  const signal = beginRun(uris);
  let doneCount = 0;

  try {
    const results = await runBatch({
      kind: operation,
      uris,
      signal,
      callbacks: {
        onProgress: handleProgress,
        onItemStart: handleItemStart,
        onItemDone: (result) => {
          doneCount += 1;
          handleItemDone(result, uris.length, doneCount);
        },
      },
    });

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.aborted).length;
    const aborted = results.filter((r) => r.aborted).length;
    const added = results.reduce((sum, r) => sum + (r.added ?? 0), 0);
    const removed = results.reduce((sum, r) => sum + (r.removed ?? 0), 0);
    const liked = results.reduce((sum, r) => sum + (r.liked ?? 0), 0);

    const parts = [`Finished: ${ok} ok`];
    if (failed) parts.push(`${failed} failed`);
    if (aborted) parts.push(`${aborted} aborted`);
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    if (liked) parts.push(`${liked} liked`);

    const summary = parts.join(" · ");
    endRun(summary, failed > 0 ? "error" : "success");
    Spicetify.showNotification(summary, failed > 0);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Operation failed";
    endRun(message, "error");
    Spicetify.showNotification("Operation failed", true);
  }
}

function App() {
  const { operation, mode, selected, running } = useOperationStore();

  useEffect(() => {
    void loadPlaylists();
  }, []);

  const targetCount =
    operation === "whatsNew" || mode === "liked" ? 1 : selected.size;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Playlist Manager</h1>
        <p className={styles.subtitle}>
          Update artist playlists, sync What's New, clean duplicates, and like
          missing tracks — across your library in parallel.
        </p>
      </header>

      <div className={styles.toolbar}>
        <ModePicker />
        <OpControls
          targetCount={targetCount}
          onStart={() => {
            if (!running) void startOperation(operation);
          }}
        />
      </div>

      <div className={styles.mainGrid}>
        <section className={`${styles.panel} ${styles.panelGrow}`}>
          <h2 className={styles.panelTitle}>
            {mode === "liked" ? "Liked Songs" : "Your playlists"}
          </h2>
          <PlaylistGrid />
        </section>

        <aside className={styles.sideColumn}>
          <SettingsPanel />
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Progress</h2>
            <ProgressPanel />
          </section>
          <div className={`${styles.panel} ${styles.panelGrow}`}>
            <LogStream />
          </div>
        </aside>
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.container}>
          <div className={styles.errorBanner}>
            Playlist Manager crashed: {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Root() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
