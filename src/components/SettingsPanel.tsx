import React, { useMemo, useState } from "react";
import { fetchFollowedArtistNames } from "@/api/following";
import { parseArtistsFromTitle } from "@/operations/normalize";
import {
  evaluateJunkTrack,
  evaluateLocalFilters,
  validatePattern,
} from "@/operations/trackFilters";
import {
  type IgnoreSettings,
  loadIgnoreSettings,
  saveIgnoreSettings,
} from "@/settings";
import styles from "../css/app.module.scss";

type RemixResult = {
  status: "idle" | "loading" | "done" | "error";
  verdict?: "keep" | "junk" | "n/a";
  reason?: string;
  originalLabel?: string;
  error?: string;
};

function defaultOwnerFromTitle(sampleTitle: string): string {
  if (sampleTitle.includes(" / ")) {
    return parseArtistsFromTitle(sampleTitle)[0] ?? "";
  }
  return "";
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<IgnoreSettings>(() =>
    loadIgnoreSettings(),
  );
  const [newPattern, setNewPattern] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [patternWarn, setPatternWarn] = useState<string | null>(null);

  const [sampleTitle, setSampleTitle] = useState("");
  const [sampleAlbum, setSampleAlbum] = useState("");
  const [ownerArtist, setOwnerArtist] = useState("");
  const [creditList, setCreditList] = useState("");
  const [remixResult, setRemixResult] = useState<RemixResult>({
    status: "idle",
  });

  const persist = (next: IgnoreSettings) => {
    setSettings(next);
    saveIgnoreSettings(next);
  };

  const localPreview = useMemo(
    () => evaluateLocalFilters(sampleTitle, sampleAlbum, settings),
    [sampleTitle, sampleAlbum, settings],
  );

  const addPattern = () => {
    const check = validatePattern(newPattern);
    if (!check.ok) {
      setPatternError(check.error ?? "Invalid pattern");
      setPatternWarn(null);
      return;
    }
    setPatternError(null);
    setPatternWarn(check.warn ?? null);
    const trimmed = newPattern.trim();
    if (settings.customPatterns.includes(trimmed)) {
      setPatternError("Pattern already added");
      return;
    }
    persist({
      ...settings,
      customPatterns: [...settings.customPatterns, trimmed],
    });
    setNewPattern("");
  };

  const removePattern = (pattern: string) => {
    persist({
      ...settings,
      customPatterns: settings.customPatterns.filter((p) => p !== pattern),
    });
  };

  const resolveOriginal = async () => {
    if (!sampleTitle.trim()) {
      setRemixResult({
        status: "error",
        error: "Enter a sample title first",
      });
      return;
    }

    const owner =
      ownerArtist.trim() || defaultOwnerFromTitle(sampleTitle) || "";
    if (!owner) {
      setRemixResult({
        status: "error",
        error: "Enter an owner artist (playlist artist) to compare",
      });
      return;
    }

    const artists = creditList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setRemixResult({ status: "loading" });
    try {
      const followedArtists = await fetchFollowedArtistNames();
      const verdict = await evaluateJunkTrack(
        {
          name: sampleTitle.trim(),
          albumName: sampleAlbum.trim() || undefined,
          artists: artists.length > 0 ? artists : [owner],
        },
        {
          ...settings,
          // Force remix path when testing resolve; still honor live/sped/custom first
          skipDjRemixes: true,
        },
        [owner],
        { followedArtists },
      );

      if (!localPreview.looksLikeRemix && verdict.category !== "remix") {
        setRemixResult({
          status: "done",
          verdict: "n/a",
          reason: verdict.junk
            ? verdict.reason
            : "Title does not look like a remix — nothing to resolve",
          originalLabel: undefined,
        });
        return;
      }

      const originalLabel = verdict.original
        ? `${verdict.original.name} — ${verdict.original.artists.join(", ") || "unknown artists"}`
        : "not found";

      setRemixResult({
        status: "done",
        verdict: verdict.junk ? "junk" : "keep",
        reason: verdict.reason,
        originalLabel,
      });
    } catch (error) {
      setRemixResult({
        status: "error",
        error: error instanceof Error ? error.message : "Resolve failed",
      });
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.settingsHeader}>
        <h2 className={styles.panelTitle}>Ignore filters</h2>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {!open ? (
        <p className={styles.hint}>
          Live, sped/slowed, DJ remixes, and custom regex — skip on Update,
          remove on Clean.
        </p>
      ) : (
        <div className={styles.settingsBody}>
          <p className={styles.hint}>
            When enabled: Update skips these tracks; Clean always removes them.
          </p>

          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={settings.skipLive}
              onChange={(e) =>
                persist({ ...settings, skipLive: e.target.checked })
              }
            />
            <span>Live versions</span>
          </label>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={settings.skipSpedSlowed}
              onChange={(e) =>
                persist({ ...settings, skipSpedSlowed: e.target.checked })
              }
            />
            <span>Sped up / slowed</span>
          </label>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={settings.skipDjRemixes}
              onChange={(e) =>
                persist({ ...settings, skipDjRemixes: e.target.checked })
              }
            />
            <span>DJ remixes (keep if remixer/co-artist followed)</span>
          </label>

          <div className={styles.settingsBlock}>
            <h3 className={styles.settingsSubTitle}>Custom regex</h3>
            <ul className={styles.patternList}>
              {settings.customPatterns.length === 0 && (
                <li className={styles.hint}>No custom patterns</li>
              )}
              {settings.customPatterns.map((pattern) => {
                const check = validatePattern(pattern);
                return (
                  <li key={pattern} className={styles.patternRow}>
                    <code className={styles.patternCode}>{pattern}</code>
                    {!check.ok && (
                      <span className={styles.patternBad}>invalid</span>
                    )}
                    {check.warn && (
                      <span className={styles.patternWarn}>long</span>
                    )}
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      onClick={() => removePattern(pattern)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={styles.patternAdd}>
              <input
                className={styles.textInput}
                value={newPattern}
                placeholder="e.g. \\bacapella\\b"
                onChange={(e) => {
                  setNewPattern(e.target.value);
                  setPatternError(null);
                  const check = validatePattern(e.target.value);
                  setPatternWarn(check.warn ?? null);
                  if (e.target.value.trim() && !check.ok) {
                    setPatternError(check.error ?? null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPattern();
                  }
                }}
              />
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={addPattern}
              >
                Add
              </button>
            </div>
            {patternError && (
              <p className={styles.patternBad}>{patternError}</p>
            )}
            {patternWarn && !patternError && (
              <p className={styles.patternWarn}>{patternWarn}</p>
            )}
          </div>

          <div className={styles.settingsBlock}>
            <h3 className={styles.settingsSubTitle}>Sample tester</h3>
            <label className={styles.fieldLabel}>
              Title
              <input
                className={styles.textInput}
                value={sampleTitle}
                onChange={(e) => {
                  setSampleTitle(e.target.value);
                  setRemixResult({ status: "idle" });
                }}
                placeholder="Song (DJ Foo Remix)"
              />
            </label>
            <label className={styles.fieldLabel}>
              Album (optional)
              <input
                className={styles.textInput}
                value={sampleAlbum}
                onChange={(e) => setSampleAlbum(e.target.value)}
                placeholder="Album name"
              />
            </label>

            <div className={styles.testerResults}>
              <div>
                Live: <strong>{localPreview.live ? "match" : "no"}</strong>
              </div>
              <div>
                Sped/slowed:{" "}
                <strong>{localPreview.sped ? "match" : "no"}</strong>
              </div>
              <div>
                Remix-like:{" "}
                <strong>{localPreview.looksLikeRemix ? "yes" : "no"}</strong>
              </div>
              <div>
                Custom:{" "}
                <strong>
                  {localPreview.customHits.length > 0
                    ? localPreview.customHits.join(", ")
                    : "no match"}
                </strong>
              </div>
            </div>

            <label className={styles.fieldLabel}>
              Owner artist
              <input
                className={styles.textInput}
                value={ownerArtist}
                onChange={(e) => setOwnerArtist(e.target.value)}
                placeholder="Playlist artist name"
              />
            </label>
            <label className={styles.fieldLabel}>
              Remix credits (comma-separated, lead first)
              <input
                className={styles.textInput}
                value={creditList}
                onChange={(e) => setCreditList(e.target.value)}
                placeholder="Artist A, DJ Foo"
              />
            </label>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={remixResult.status === "loading"}
              onClick={() => {
                void resolveOriginal();
              }}
            >
              {remixResult.status === "loading"
                ? "Resolving…"
                : "Resolve original"}
            </button>

            {remixResult.status === "error" && (
              <p className={styles.patternBad}>{remixResult.error}</p>
            )}
            {remixResult.status === "done" && (
              <div className={styles.testerResults}>
                {remixResult.originalLabel && (
                  <div>
                    Original: <strong>{remixResult.originalLabel}</strong>
                  </div>
                )}
                <div>
                  Verdict:{" "}
                  <strong
                    className={
                      remixResult.verdict === "junk"
                        ? styles.verdictJunk
                        : remixResult.verdict === "keep"
                          ? styles.verdictKeep
                          : undefined
                    }
                  >
                    {remixResult.verdict}
                  </strong>
                </div>
                <div className={styles.hint}>{remixResult.reason}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
