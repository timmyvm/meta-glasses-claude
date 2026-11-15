import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { errorText, postStep, type StepSuggestion } from "../api";
import { preparePhoto } from "../photo";
import { loadGame, saveGame, type Settings } from "../settings";
import { speak } from "../speech";
import type { Glasses } from "./useGlasses";
import type { LogLevel } from "./useLog";

/** Delay before the next photo when the server asks to recheck soon. */
const RECHECK_DELAY_MS = 700;
/** If the glasses stream dropped while watching, retry starting it this often. */
const STREAM_RETRY_MS = 10_000;
const KEEP_AWAKE_TAG = "irl-engine-watching";

export type Phase =
  | "idle"
  | "starting"
  | "waitingForVideo"
  | "capturing"
  | "thinking"
  | "waiting";

export type Reading = {
  /** Latest non-null suggestion (kept until New game so the card doesn't blink). */
  suggestion: StepSuggestion | null;
  myTurn: boolean | null;
  placement: string | null;
};

export type Timing = {
  captureMs: number;
  roundTripMs: number;
  serverMs: number;
  skipped: boolean;
  /** e.g. "3024×4032 → 1200×1600 · 280 KB" */
  photo: string;
  at: number;
};

const EMPTY_READING: Reading = { suggestion: null, myTurn: null, placement: null };

type Options = {
  glasses: Glasses;
  settings: Settings;
  log: (level: LogLevel, text: string) => void;
};

/**
 * The capture loop: photo from the glasses -> resize -> POST /api/step ->
 * speak `say`. One request in flight at most; a tick that finds the loop busy
 * is skipped. `recheckSoon` shortens the wait to ~700ms.
 */
export function useWatcher({ glasses, settings, log }: Options) {
  const [watching, setWatching] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reading, setReading] = useState<Reading>(EMPTY_READING);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [lastSay, setLastSay] = useState<string | null>(null);
  const [hasGame, setHasGame] = useState(false);

  // Refs so the async loop always sees the latest values.
  const glassesRef = useRef(glasses);
  glassesRef.current = glasses;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const logRef = useRef(log);
  logRef.current = log;

  const watchingRef = useRef(false);
  const busyRef = useRef(false);
  const manualQueuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameRef = useRef<{ state: unknown | null; gate: unknown | null }>({ state: null, gate: null });
  /** Bumped by New game so replies to older requests are dropped. */
  const epochRef = useRef(0);
  const lastStreamAttemptRef = useRef(0);
  const resumeOnActiveRef = useRef(false);
  const tickRef = useRef<(trigger: "auto" | "manual") => Promise<void>>(async () => {});

  // Restore the tracked game after an app restart.
  useEffect(() => {
    loadGame().then((g) => {
      if (g.state === null && g.gate === null) return;
      gameRef.current = g;
      setHasGame(true);
      logRef.current("info", "Resumed the tracked game. Tap New game to start over.");
    });
  }, []);

  const schedule = useCallback((delayMs: number, trigger: "auto" | "manual" = "auto") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      tickRef.current(trigger);
    }, delayMs);
  }, []);

  const tick = useCallback(
    async (trigger: "auto" | "manual") => {
      if (busyRef.current) {
        // Never more than one request in flight. A manual ask runs right after.
        if (trigger === "manual") manualQueuedRef.current = true;
        return;
      }
      if (!watchingRef.current) return;

      busyRef.current = true;
      const s = settingsRef.current;
      let nextDelay = s.intervalSec * 1000;

      try {
        const g = glassesRef.current;

        if (!g.sessionId) {
          // The stream dropped (glasses folded, disconnected, ...). Try again now and then.
          if (Date.now() - lastStreamAttemptRef.current >= STREAM_RETRY_MS) {
            lastStreamAttemptRef.current = Date.now();
            setPhase("starting");
            await g.startStream(s.streamQuality);
            // Stopped while the stream was starting: don't leave the camera on.
            if (!watchingRef.current) await glassesRef.current.stopStream();
          } else {
            setPhase("waitingForVideo");
          }
          return;
        }
        if (!g.isStreaming) {
          setPhase("waitingForVideo");
          if (trigger === "manual") logRef.current("info", "Glasses video isn't running yet.");
          nextDelay = Math.min(nextDelay, 1000);
          return;
        }

        setPhase("capturing");
        const photo = await g.capture();

        setPhase("thinking");
        const prepared = await preparePhoto(photo);
        const epoch = epochRef.current;
        const t0 = Date.now();
        const res = await postStep(s.serverUrl, s.token, {
          image: prepared.base64,
          viewer: s.viewer,
          trigger,
          state: gameRef.current.state,
          gate: gameRef.current.gate,
        });
        const roundTripMs = Date.now() - t0;

        if (epoch !== epochRef.current) {
          logRef.current("info", "Dropped a reply from before New game.");
          return;
        }

        gameRef.current = { state: res.state, gate: res.gate };
        setHasGame(true);
        saveGame(gameRef.current);

        const src =
          prepared.sourceWidth && prepared.sourceHeight
            ? `${prepared.sourceWidth}×${prepared.sourceHeight} → `
            : "";
        setTiming({
          captureMs: photo.captureMs,
          roundTripMs,
          serverMs: res.ms,
          skipped: res.skipped,
          photo: `${src}${prepared.width}×${prepared.height} · ${prepared.kb} KB`,
          at: Date.now(),
        });
        setReading((prev) => ({
          suggestion: res.suggestion ?? prev.suggestion,
          myTurn: res.myTurn ?? prev.myTurn,
          placement: res.placement ?? prev.placement,
        }));

        for (const line of res.log) logRef.current(line.level, line.text);

        if (res.say) {
          setLastSay(res.say);
          // If the user hit Stop while this was in flight, stay quiet unless they asked.
          if (watchingRef.current || trigger === "manual") speak(res.say, s.speechRate);
        }
        if (res.recheckSoon) nextDelay = RECHECK_DELAY_MS;
      } catch (err) {
        // After Stop, an aborted capture is expected; don't report it.
        if (watchingRef.current) logRef.current("error", errorText(err));
      } finally {
        busyRef.current = false;
        if (watchingRef.current) {
          if (manualQueuedRef.current) {
            manualQueuedRef.current = false;
            schedule(0, "manual");
          } else {
            schedule(nextDelay, "auto");
          }
          setPhase((p) => (p === "starting" || p === "waitingForVideo" ? p : "waiting"));
        } else {
          manualQueuedRef.current = false;
          setPhase("idle");
        }
      }
    },
    [schedule],
  );
  tickRef.current = tick;

  const start = useCallback(async () => {
    if (watchingRef.current) return;
    const s = settingsRef.current;
    if (!s.serverUrl.trim()) {
      logRef.current("warn", "Set the server URL in Settings first.");
      return;
    }
    watchingRef.current = true;
    setWatching(true);
    setPhase("starting");
    lastStreamAttemptRef.current = Date.now();
    try {
      await glassesRef.current.startStream(s.streamQuality);
    } catch (err) {
      // Stopping during start makes startStream throw; that's not worth an error line.
      if (watchingRef.current) logRef.current("error", errorText(err));
      watchingRef.current = false;
      setWatching(false);
      setPhase("idle");
      return;
    }
    if (!watchingRef.current) {
      // Stop was pressed while the stream was starting.
      await glassesRef.current.stopStream();
      return;
    }
    // The first tick waits for video if the stream isn't up yet.
    schedule(800);
  }, [schedule]);

  const stop = useCallback(async () => {
    watchingRef.current = false;
    manualQueuedRef.current = false;
    setWatching(false);
    setPhase("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    await glassesRef.current.stopStream();
  }, []);

  /** Take a photo now and ask for a move even if the board looks unchanged. */
  const askNow = useCallback(() => {
    if (!watchingRef.current) {
      logRef.current("info", "Start watching first, so the glasses camera is running.");
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    tickRef.current("manual");
  }, []);

  const newGame = useCallback(() => {
    epochRef.current += 1;
    gameRef.current = { state: null, gate: null };
    saveGame(gameRef.current);
    setHasGame(false);
    setReading(EMPTY_READING);
    setLastSay(null);
    setTiming(null);
    logRef.current("info", "New game. Tracking starts from the next photo.");
  }, []);

  const sayAgain = useCallback(() => {
    if (lastSay) speak(lastSay, settingsRef.current.speechRate);
    else logRef.current("info", "Nothing to repeat yet.");
  }, [lastSay]);

  const testVoice = useCallback(() => {
    speak("Knight F3", settingsRef.current.speechRate);
  }, []);

  // Keep the screen on while watching (the SDK can't stream in the background).
  useEffect(() => {
    if (!watching) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [watching]);

  // iOS stops the glasses stream in the background: stop cleanly, resume on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && watchingRef.current) {
        resumeOnActiveRef.current = true;
        logRef.current("warn", "Paused: IRL Engine went to the background. Keep it open while you play.");
        stop();
      } else if (state === "active" && resumeOnActiveRef.current) {
        resumeOnActiveRef.current = false;
        logRef.current("info", "Back in the app, resuming.");
        start();
      }
    });
    return () => sub.remove();
  }, [start, stop]);

  // Stop the timer on unmount.
  useEffect(() => {
    return () => {
      watchingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    watching,
    phase,
    reading,
    timing,
    lastSay,
    hasGame,
    start,
    stop,
    askNow,
    newGame,
    sayAgain,
    testVoice,
  };
}
