import React, { useEffect, useState } from "react";
import { getLikedSongsTrackCount } from "@/api/library";
import type { ItemStatus, PlaylistCard } from "@/operations/types";
import { LIKED_SONGS_IMAGE_URL, LIKED_SONGS_URI } from "@/operations/types";
import {
  setLikedTrackCount,
  setPlaylistQuery,
  toggleSelect,
} from "@/store/operationStore";
import { useOperationStore } from "@/store/useOperationStore";
import styles from "../css/app.module.scss";

// Spicetify creator bundles with classic JSX (needs React in scope).
void React;

function nameMatches(name: string, q: string): boolean {
  return q === "" || name.toLowerCase().includes(q);
}

function statusClass(status: ItemStatus): string {
  switch (status) {
    case "running":
      return styles.badgeRunning ?? "";
    case "done":
      return styles.badgeDone ?? "";
    case "failed":
      return styles.badgeFailed ?? "";
    case "skipped":
      return styles.badgeSkipped ?? "";
    default:
      return styles.badgeIdle ?? "";
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

function PlaylistSearch() {
  const { playlistQuery } = useOperationStore();
  const [draft, setDraft] = useState(playlistQuery);

  useEffect(() => {
    setDraft(playlistQuery);
  }, [playlistQuery]);

  useEffect(() => {
    if (draft === playlistQuery) return;
    const id = window.setTimeout(() => setPlaylistQuery(draft), 200);
    return () => window.clearTimeout(id);
  }, [draft, playlistQuery]);

  return (
    <div className={styles.playlistSearch}>
      <input
        type="search"
        className={`${styles.textInput} ${styles.playlistSearchInput}`}
        placeholder="Search playlists…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Search playlists"
      />
      {draft !== "" && (
        <button
          type="button"
          className={styles.playlistSearchClear}
          onClick={() => {
            setDraft("");
            setPlaylistQuery("");
          }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
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
    playlistQuery,
  } = useOperationStore();

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh count after operations
  useEffect(() => {
    if (mode !== "liked") return;
    let cancelled = false;
    void (async () => {
      try {
        const count = await getLikedSongsTrackCount();
        if (!cancelled) setLikedTrackCount(count);
      } catch (error) {
        console.error("[ERROR] Failed to count Liked Songs:", error);
        if (!cancelled) setLikedTrackCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, running]);

  const q = playlistQuery.trim().toLowerCase();

  if (loadError) {
    return <div className={styles.errorBanner}>{loadError}</div>;
  }

  if (loadingPlaylists) {
    return <div className={styles.empty}>Loading playlists…</div>;
  }

  if (mode === "liked") {
    const likedCard: PlaylistCard = {
      uri: LIKED_SONGS_URI,
      name: "Liked Songs",
      trackCount: likedTrackCount ?? -1,
      imageUrl: LIKED_SONGS_IMAGE_URL,
      owned: true,
    };
    const show = nameMatches(likedCard.name, q);

    return (
      <>
        <PlaylistSearch />
        {show ? (
          <div className={styles.playlistGrid}>
            <div className={styles.cardCell}>
              <PlaylistCardView
                card={likedCard}
                selected
                status={statuses.get(LIKED_SONGS_URI) ?? "idle"}
                progress={itemProgress.get(LIKED_SONGS_URI) ?? 0}
                selectable={false}
              />
            </div>
          </div>
        ) : (
          <div className={styles.empty}>No playlists match.</div>
        )}
      </>
    );
  }

  if (playlists.length === 0) {
    return <div className={styles.empty}>No owned playlists found.</div>;
  }

  const filtered = playlists.filter((card) => nameMatches(card.name, q));
  const selectable = !running;

  return (
    <>
      <PlaylistSearch />
      {filtered.length === 0 ? (
        <div className={styles.empty}>No playlists match.</div>
      ) : (
        <div className={styles.playlistGrid}>
          {filtered.map((card) => (
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
      )}
    </>
  );
}
