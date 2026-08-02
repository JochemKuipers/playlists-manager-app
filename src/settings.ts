export type IgnoreSettings = {
  skipLive: boolean;
  skipSpedSlowed: boolean;
  skipDjRemixes: boolean;
  skipInstrumental: boolean;
  skipCommentary: boolean;
  skipAcapella: boolean;
  /** What's New only — block SoulOverAI / CennoxX / Zoundhub AI artists. */
  skipAiArtists: boolean;
  customPatterns: string[];
};

const STORAGE_KEY = "playlist-manager-ignore-settings";

export const DEFAULT_IGNORE_SETTINGS: IgnoreSettings = {
  skipLive: true,
  skipSpedSlowed: true,
  skipDjRemixes: true,
  skipInstrumental: true,
  skipCommentary: true,
  skipAcapella: true,
  skipAiArtists: true,
  customPatterns: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function loadIgnoreSettings(): IgnoreSettings {
  try {
    const raw = Spicetify.LocalStorage.get(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_IGNORE_SETTINGS, customPatterns: [] };

    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return { ...DEFAULT_IGNORE_SETTINGS, customPatterns: [] };
    }

    const patterns = Array.isArray(parsed.customPatterns)
      ? parsed.customPatterns.filter((p): p is string => typeof p === "string")
      : [];

    return {
      skipLive: boolOrDefault(
        parsed.skipLive,
        DEFAULT_IGNORE_SETTINGS.skipLive,
      ),
      skipSpedSlowed: boolOrDefault(
        parsed.skipSpedSlowed,
        DEFAULT_IGNORE_SETTINGS.skipSpedSlowed,
      ),
      skipDjRemixes: boolOrDefault(
        parsed.skipDjRemixes,
        DEFAULT_IGNORE_SETTINGS.skipDjRemixes,
      ),
      skipInstrumental: boolOrDefault(
        parsed.skipInstrumental,
        DEFAULT_IGNORE_SETTINGS.skipInstrumental,
      ),
      skipCommentary: boolOrDefault(
        parsed.skipCommentary,
        DEFAULT_IGNORE_SETTINGS.skipCommentary,
      ),
      skipAcapella: boolOrDefault(
        parsed.skipAcapella,
        DEFAULT_IGNORE_SETTINGS.skipAcapella,
      ),
      skipAiArtists: boolOrDefault(
        parsed.skipAiArtists,
        DEFAULT_IGNORE_SETTINGS.skipAiArtists,
      ),
      customPatterns: patterns,
    };
  } catch (error) {
    console.warn("[WARN] Failed to load ignore settings:", error);
    return { ...DEFAULT_IGNORE_SETTINGS, customPatterns: [] };
  }
}

export function saveIgnoreSettings(settings: IgnoreSettings): void {
  try {
    Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[WARN] Failed to save ignore settings:", error);
  }
}

export function hasAnyIgnoreFilter(settings: IgnoreSettings): boolean {
  return (
    settings.skipLive ||
    settings.skipSpedSlowed ||
    settings.skipDjRemixes ||
    settings.skipInstrumental ||
    settings.skipCommentary ||
    settings.skipAcapella ||
    settings.customPatterns.some((p) => p.trim().length > 0)
  );
}

export type WhatsNewAutoSettings = {
  enabled: boolean;
  intervalMinutes: number;
};

const AUTO_STORAGE_KEY = "playlist-manager-whatsnew-autosync";
export const WHATS_NEW_AUTO_MIN_MINUTES = 15;
export const WHATS_NEW_AUTO_MAX_MINUTES = 1440;

export const DEFAULT_WHATS_NEW_AUTO_SETTINGS: WhatsNewAutoSettings = {
  enabled: false,
  intervalMinutes: 60,
};

export function clampWhatsNewIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WHATS_NEW_AUTO_SETTINGS.intervalMinutes;
  }
  return Math.min(
    WHATS_NEW_AUTO_MAX_MINUTES,
    Math.max(WHATS_NEW_AUTO_MIN_MINUTES, Math.round(value)),
  );
}

export function loadWhatsNewAutoSettings(): WhatsNewAutoSettings {
  try {
    const raw = Spicetify.LocalStorage.get(AUTO_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WHATS_NEW_AUTO_SETTINGS };

    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return { ...DEFAULT_WHATS_NEW_AUTO_SETTINGS };

    const minutes =
      typeof parsed.intervalMinutes === "number"
        ? parsed.intervalMinutes
        : DEFAULT_WHATS_NEW_AUTO_SETTINGS.intervalMinutes;

    return {
      enabled: boolOrDefault(
        parsed.enabled,
        DEFAULT_WHATS_NEW_AUTO_SETTINGS.enabled,
      ),
      intervalMinutes: clampWhatsNewIntervalMinutes(minutes),
    };
  } catch (error) {
    console.warn("[WARN] Failed to load What's New autosync settings:", error);
    return { ...DEFAULT_WHATS_NEW_AUTO_SETTINGS };
  }
}

export function saveWhatsNewAutoSettings(settings: WhatsNewAutoSettings): void {
  try {
    Spicetify.LocalStorage.set(
      AUTO_STORAGE_KEY,
      JSON.stringify({
        enabled: settings.enabled,
        intervalMinutes: clampWhatsNewIntervalMinutes(settings.intervalMinutes),
      }),
    );
  } catch (error) {
    console.warn("[WARN] Failed to save What's New autosync settings:", error);
  }
}
