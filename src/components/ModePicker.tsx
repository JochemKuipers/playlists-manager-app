import React from "react";
import type { SelectionMode } from "@/operations/types";
import { clearSelection, selectAll, setMode } from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

const MODES: { id: SelectionMode; label: string }[] = [
  { id: "playlists", label: "Playlists" },
  { id: "liked", label: "Liked Songs" },
];

export function ModePicker() {
  const { mode, running, playlists, selected } = useOperationStore();
  const allSelected =
    playlists.length > 0 && selected.size === playlists.length;

  return (
    <div className={styles.modeRow}>
      <div className={styles.segmented}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={m.label}
            aria-pressed={mode === m.id}
            className={`${styles.segBtn} ${mode === m.id ? styles.segBtnActive : ""}`}
            disabled={running}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "playlists" && (
        <div className={styles.selectActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={running || playlists.length === 0 || allSelected}
            onClick={selectAll}
          >
            Select all
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={running || selected.size === 0}
            onClick={clearSelection}
          >
            Clear
          </button>
          <span className={styles.hint}>{selected.size} selected</span>
        </div>
      )}
    </div>
  );
}
