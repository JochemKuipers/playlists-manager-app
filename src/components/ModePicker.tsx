import React from "react";
import type { SelectionMode } from "@/operations/types";
import { setMode } from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

const MODES: { id: SelectionMode; label: string }[] = [
  { id: "all", label: "All playlists" },
  { id: "selection", label: "Selection" },
  { id: "single", label: "Single" },
  { id: "liked", label: "Liked Songs" },
];

export function ModePicker() {
  const { mode, running } = useOperationStore();

  return (
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
  );
}
