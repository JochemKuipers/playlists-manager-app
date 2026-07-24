import React from "react";
import type { OperationKind } from "@/operations/types";
import { requestStop, setOperation } from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

const OPS: { id: OperationKind; label: string; hint: string }[] = [
  {
    id: "update",
    label: "Update",
    hint: 'Append missing discography tracks from title "Artist1 / Artist2"',
  },
  {
    id: "clean",
    label: "Clean",
    hint: "Remove duplicate tracks (keep earliest / Spotify / explicit)",
  },
  {
    id: "likeMissing",
    label: "Like Missing",
    hint: "Like playlist tracks that are not already in Liked Songs",
  },
];

type Props = {
  onStart: () => void;
  targetCount: number;
};

export function OpControls({ onStart, targetCount }: Props) {
  const { operation, mode, running } = useOperationStore();
  const likedMode = mode === "liked";

  return (
    <div className={styles.actions}>
      <div className={styles.segmented}>
        {OPS.map((op) => {
          const disabled = running || (likedMode && op.id !== "clean");
          return (
            <button
              key={op.id}
              type="button"
              title={op.hint}
              aria-label={op.label}
              aria-pressed={operation === op.id}
              className={`${styles.segBtn} ${operation === op.id ? styles.segBtnActive : ""}`}
              disabled={disabled}
              onClick={() => setOperation(op.id)}
            >
              {op.label}
            </button>
          );
        })}
      </div>

      {!running ? (
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={targetCount === 0}
          onClick={onStart}
        >
          Start ({targetCount})
        </button>
      ) : (
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={requestStop}
        >
          Stop
        </button>
      )}

      <span className={styles.hint}>
        {OPS.find((o) => o.id === operation)?.hint}
      </span>
    </div>
  );
}
