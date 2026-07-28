import React, { useEffect, useRef } from "react";
import type { LogKind } from "@/operations/types";
import { clearLogs } from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

// Spicetify creator bundles with classic JSX (needs React in scope).
void React;

function kindClass(kind: LogKind): string {
  switch (kind) {
    case "add":
      return styles.logAdd ?? "";
    case "remove":
      return styles.logRemove ?? "";
    case "skip":
      return styles.logSkip ?? "";
    case "error":
      return styles.logError ?? "";
    case "success":
      return styles.logSuccess ?? "";
    default:
      return styles.logInfo ?? "";
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LogStream() {
  const { logs } = useOperationStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when log stream grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <h3 className={styles.panelTitle}>Operation log</h3>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={clearLogs}
        >
          Clear
        </button>
      </div>
      {logs.length === 0 ? (
        <div className={styles.empty}>
          Logs will appear here when you start an operation.
        </div>
      ) : (
        <div className={styles.logStream}>
          {logs.map((log) => (
            <div key={log.id} className={styles.logLine}>
              <span className={styles.logTime}>{formatTime(log.ts)}</span>
              <span className={`${styles.logKind} ${kindClass(log.kind)}`}>
                {log.kind}
              </span>
              <span>{log.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </>
  );
}
