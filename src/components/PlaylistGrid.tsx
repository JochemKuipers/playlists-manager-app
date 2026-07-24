import React, { useEffect } from "react";
import { getLikedSongsTrackCount } from "@/api/library";
import type { ItemStatus, PlaylistCard } from "@/operations/types";
import {
  LIKED_SONGS_IMAGE_URL,
  LIKED_SONGS_URI,
} from "@/operations/types";
import { setLikedTrackCount, toggleSelect } from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

function statusClass(status: ItemStatus): string {
  switch (status) {
    case "running":
      return styles.badgeRunning;
    case "done":
      return styles.badgeDone;
    case "failed":
      return styles.badgeFailed;
    case "skipped":
      return styles.badgeSkipped;
    default:
      return styles.badgeIdle;
  }
}

function PlaylistCardView({
  card,
  selected,
  status,
  progress,
  selectable,
}: {
  card: PlaylistCard;
  selected: boolean;
  status: ItemStatus;
  progress: number;
  selectable: boolean;
}) {
  const trackLabel =
    typeof card.trackCount === "number" && card.trackCount >= 0
      ? `${card.trackCount.toLocaleString()} tracks`
      : "— tracks";

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${status === "running" ? styles.cardRunning : ""}`}
      onClick={() => selectable && toggleSelect(card.uri)}
      disabled={!selectable}
      aria-pressed={selected}
    >
      {card.imageUrl ? (
        <img
          className={styles.cardArt}
          src={card.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className={styles.cardArtPlaceholder} />
      )}
      <div className={styles.cardName}>{card.name}</div>
      <div className={styles.cardMeta}>
        <span>{trackLabel}</span>
        <span className={`${styles.badge} ${statusClass(status)}`}>
          {status}
        </span>
      </div>
      {(status === "running" || progress > 0) && (
        <div className={styles.miniBar}>
          <div
            className={styles.miniBarFill}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </button>
  );
}

export function PlaylistGrid() {
  const {
    mode,
    playlists,
    selected,
    statuses,
    itemProgress,
    loadingPlaylists,
    loadError,
    running,
    likedTrackCount,
  } = useOperationStore();

  useEffect(() => {
    if (mode !== "liked") return;
    let cancelled = false;
    void (async () => {
      const count = await getLikedSongsTrackCount();
      if (!cancelled) setLikedTrackCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, running]);

  if (loadError) {
    return <div className={styles.errorBanner}>{loadError}</div>;
  }

  if (loadingPlaylists) {
    return <div className={styles.empty}>Loading playlists…</div>;
  }

  if (mode === "liked") {
    const status = statuses.get(LIKED_SONGS_URI) ?? "idle";
    const progress = itemProgress.get(LIKED_SONGS_URI) ?? 0;
    return (
      <div className={styles.playlistGrid}>
        <div className={styles.cardCell}>
          <PlaylistCardView
            card={{
              uri: LIKED_SONGS_URI,
              name: "Liked Songs",
              trackCount: likedTrackCount ?? -1,
              imageUrl: LIKED_SONGS_IMAGE_URL,
              owned: true,
            }}
            selected
            status={status}
            progress={progress}
            selectable={false}
          />
        </div>
      </div>
    );
  }

  if (playlists.length === 0) {
    return <div className={styles.empty}>No owned playlists found.</div>;
  }

  const selectable = !running;

  return (
    <div className={styles.playlistGrid}>
      {playlists.map((card) => (
        <div key={card.uri} className={styles.cardCell}>
          <PlaylistCardView
            card={card}
            selected={selected.has(card.uri)}
            status={statuses.get(card.uri) ?? "idle"}
            progress={itemProgress.get(card.uri) ?? 0}
            selectable={selectable}
          />
        </div>
      ))}
    </div>
  );
}
