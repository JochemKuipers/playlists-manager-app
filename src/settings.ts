export type IgnoreSettings = {
  skipLive: boolean;
  skipSpedSlowed: boolean;
  skipDjRemixes: boolean;
  customPatterns: string[];
};

const STORAGE_KEY = "playlist-manager-ignore-settings";

export const DEFAULT_IGNORE_SETTINGS: IgnoreSettings = {
  skipLive: true,
  skipSpedSlowed: true,
  skipDjRemixes: true,
  customPatterns: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      ? parsed.customPatterns.filter(
          (p): p is string => typeof p === "string",
        )
      : [];

    return {
      skipLive:
        typeof parsed.skipLive === "boolean"
          ? parsed.skipLive
          : DEFAULT_IGNORE_SETTINGS.skipLive,
      skipSpedSlowed:
        typeof parsed.skipSpedSlowed === "boolean"
          ? parsed.skipSpedSlowed
          : DEFAULT_IGNORE_SETTINGS.skipSpedSlowed,
      skipDjRemixes:
        typeof parsed.skipDjRemixes === "boolean"
          ? parsed.skipDjRemixes
          : DEFAULT_IGNORE_SETTINGS.skipDjRemixes,
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
