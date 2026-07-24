import React from "react";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

export function ProgressPanel() {
  const {
    overallProgress,
    running,
    playlists,
    selected,
    mode,
    statuses,
    itemMessages,
    itemProgress,
  } = useOperationStore();

  const activeUris =
    mode === "liked"
      ? ["spotify:collection:tracks"]
      : mode === "all"
        ? playlists.map((p) => p.uri)
        : [...selected];

  const nameByUri = new Map(playlists.map((p) => [p.uri, p.name]));
  nameByUri.set("spotify:collection:tracks", "Liked Songs");

  const interesting = activeUris.filter((uri) => {
    const s = statuses.get(uri);
    return s && s !== "idle";
  });

  return (
    <div className={styles.progressBlock}>
      <div className={styles.progressLabel}>
        <span>{running ? "Running…" : "Overall progress"}</span>
        <span>{Math.round(overallProgress * 100)}%</span>
      </div>
      <div className={styles.bar}>
        <div
          className={styles.barFill}
          style={{ width: `${Math.round(overallProgress * 100)}%` }}
        />
      </div>

      {interesting.length > 0 && (
        <div className={styles.perItemList}>
          {interesting.map((uri) => (
            <div key={uri} className={styles.perItemRow}>
              <span className={styles.perItemName}>
                {nameByUri.get(uri) ?? uri}
              </span>
              <span>{Math.round((itemProgress.get(uri) ?? 0) * 100)}%</span>
              <span className={styles.perItemMsg}>
                {itemMessages.get(uri) ?? statuses.get(uri)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
