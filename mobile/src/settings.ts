import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { StreamingResolution } from "expo-meta-wearables-dat";

export type Settings = {
  serverUrl: string;
  /** Kept in the iOS Keychain (expo-secure-store), never in AsyncStorage. */
  token: string;
  viewer: "w" | "b";
  /** Seconds between automatic photos. */
  intervalSec: number;
  /** expo-speech rate, 1 = normal. */
  speechRate: number;
  /**
   * Resolution of the glasses video stream. Photos can only be taken while a
   * stream runs; "low" is enough if photo resolution doesn't depend on it.
   */
  streamQuality: StreamingResolution;
};

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "",
  token: "",
  viewer: "w",
  intervalSec: 3,
  speechRate: 1,
  streamQuality: "low",
};

export const INTERVAL_MIN = 2;
export const INTERVAL_MAX = 10;
export const SPEECH_RATES = [0.8, 1, 1.2, 1.5] as const;

const SETTINGS_KEY = "irl.settings.v1";
const TOKEN_KEY = "irl.token";
const GAME_KEY = "irl.game.v1";

type PublicSettings = Omit<Settings, "token">;

function clampInterval(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_SETTINGS.intervalSec;
  return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, v));
}

export async function loadSettings(): Promise<Settings> {
  let stored: Partial<PublicSettings> = {};
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<PublicSettings>;
  } catch {
    // Corrupt or unreadable: fall back to defaults.
  }
  let token = "";
  try {
    token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? "";
  } catch {
    // Keychain unavailable (rare). The user can re-enter it.
  }
  return {
    serverUrl: typeof stored.serverUrl === "string" ? stored.serverUrl : DEFAULT_SETTINGS.serverUrl,
    token,
    viewer: stored.viewer === "b" ? "b" : "w",
    intervalSec: clampInterval(stored.intervalSec),
    speechRate:
      typeof stored.speechRate === "number" && stored.speechRate > 0
        ? stored.speechRate
        : DEFAULT_SETTINGS.speechRate,
    streamQuality:
      stored.streamQuality === "medium" || stored.streamQuality === "high"
        ? stored.streamQuality
        : DEFAULT_SETTINGS.streamQuality,
  };
}

export async function saveSettings(s: Settings, prevToken: string): Promise<void> {
  const { token, ...pub } = s;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(pub));
  if (token !== prevToken) {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export { clampInterval };

// ---- Game tracking state (opaque server blobs), kept so an app restart mid-game doesn't lose it ----

export type SavedGame = { state: unknown | null; gate: unknown | null };

export async function loadGame(): Promise<SavedGame> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedGame>;
      return { state: parsed.state ?? null, gate: parsed.gate ?? null };
    }
  } catch {
    // ignore
  }
  return { state: null, gate: null };
}

export async function saveGame(game: SavedGame): Promise<void> {
  try {
    if (game.state === null && game.gate === null) await AsyncStorage.removeItem(GAME_KEY);
    else await AsyncStorage.setItem(GAME_KEY, JSON.stringify(game));
  } catch {
    // Non-fatal: worst case a restart starts a new game.
  }
}
