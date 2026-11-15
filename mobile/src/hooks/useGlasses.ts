import { Camera } from "expo-camera";
import {
  addStreamToSession,
  capturePhoto,
  checkPermissionStatus,
  createSession,
  disableMockDeviceKit,
  enableMockDeviceKit,
  getRegistrationStateAsync,
  handleUrl,
  mockDeviceDon,
  mockDevicePowerOn,
  mockDeviceSetCameraFeedFromCamera,
  mockDeviceUnfold,
  pairMockDevice,
  removeStreamFromSession,
  requestPermission,
  startRegistration,
  startSession,
  stopSession,
  unpairMockDevice,
  useMetaWearables,
  type DeviceSessionState,
  type LinkState,
  type PermissionStatus,
  type PhotoData,
  type RegistrationState,
  type StreamingResolution,
  type StreamSessionError,
} from "expo-meta-wearables-dat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

import { errorText } from "../api";
import { deleteQuietly } from "../photo";

export type CapturedPhoto = PhotoData & {
  /** Time from capturePhoto() to the onPhotoCaptured event. */
  captureMs: number;
};

export type GlassesLog = (level: "info" | "warn" | "error", text: string) => void;

/** Must match the plugin's urlScheme in app.json. */
const URL_SCHEME = "irlengine";
const CAPTURE_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 15_000;

type PendingCapture = {
  resolve: (p: CapturedPhoto) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
};

function describeStreamError(e: StreamSessionError): string {
  switch (e.type) {
    case "hingesClosed":
      return "Glasses are folded. Unfold them to stream.";
    case "thermalCritical":
      return "Glasses are too hot; streaming paused.";
    case "permissionDenied":
      return "Camera permission denied in the Meta AI app.";
    case "deviceNotConnected":
      return "Glasses not connected.";
    case "deviceNotFound":
      return "Glasses not found.";
    case "timeout":
      return "Stream timed out.";
    default:
      return `Stream error: ${e.type}`;
  }
}

/**
 * Everything about the glasses: registration, camera permission, one stream
 * session (photos only work while a stream runs), photo capture as a promise,
 * and the debug-only mock device ("test with phone camera").
 */
export function useGlasses(log: GlassesLog) {
  const logRef = useRef(log);
  logRef.current = log;

  const [registration, setRegistration] = useState<RegistrationState>("unavailable");
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<DeviceSessionState | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [busy, setBusy] = useState(false);

  const sessionRef = useRef<string | null>(null);
  const sessionStatesRef = useRef<Record<string, DeviceSessionState>>({});
  const sessionWaitersRef = useRef<((id: string, s: DeviceSessionState) => void)[]>([]);
  const pendingRef = useRef<PendingCapture | null>(null);
  const mockIdRef = useRef<string | null>(null);

  const wearables = useMetaWearables({
    logLevel: __DEV__ ? "info" : "warn",
    onRegistrationStateChange: (state) => setRegistration(state),
    onLinkStateChange: (deviceId, linkState) =>
      setLinkStates((prev) => ({ ...prev, [deviceId]: linkState })),
    onPhotoCaptured: (photo) => {
      const pending = pendingRef.current;
      if (!pending) {
        // A late photo after a timeout. Nobody wants it; clean up the temp file.
        deleteQuietly(photo.filePath);
        return;
      }
      clearTimeout(pending.timer);
      pendingRef.current = null;
      pending.resolve({ ...photo, captureMs: Date.now() - pending.startedAt });
    },
    onStreamError: (e) => logRef.current("warn", describeStreamError(e)),
    onDeviceSessionError: (_id, error, message) =>
      logRef.current("warn", `Glasses session error: ${error}${message ? ` (${message})` : ""}`),
    onDeviceSessionStateChange: (id, state) => {
      sessionStatesRef.current[id] = state;
      sessionWaitersRef.current.forEach((w) => w(id, state));
      if (id !== sessionRef.current) return;
      setSessionState(state);
      if (state === "stopped") {
        // The SDK ended the session (glasses off, disconnected, ...). The native
        // module removes the session but NOT its stream entry, and capturePhoto()
        // picks the first stream it has, so remove it or captures hit a dead stream.
        removeStreamFromSession(id).catch(() => {});
        sessionRef.current = null;
        setSessionId(null);
        logRef.current("warn", "Glasses session ended.");
      }
    },
  });

  const { isConfigured, configError, devices, streamState, permissionStatus } = wearables;
  const refreshDevices = wearables.refreshDevices;
  const checkPermission = wearables.checkPermissionStatus;

  const refresh = useCallback(async () => {
    if (!isConfigured) return;
    try {
      const reg = await getRegistrationStateAsync();
      setRegistration(reg);
      if (reg === "registered") await checkPermission("camera");
    } catch {
      // Not fatal; events will keep state fresh.
    }
    try {
      await refreshDevices();
    } catch {
      // ignore
    }
  }, [isConfigured, checkPermission, refreshDevices]);

  // Sync once configured, and every time the app comes back to the foreground
  // (e.g. returning from the Meta AI app after registration or permission).
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // If iOS killed the app while the user was in Meta AI, the registration
  // callback (irlengine://...) cold-launches it. The native URL hook then runs
  // before JS has configured the SDK, so hand the launch URL to the SDK again
  // once it is configured. An already-handled or unrelated URL is ignored.
  const initialUrlHandledRef = useRef(false);
  useEffect(() => {
    if (!isConfigured || initialUrlHandledRef.current) return;
    initialUrlHandledRef.current = true;
    Linking.getInitialURL()
      .then(async (url) => {
        if (!url || !url.startsWith(`${URL_SCHEME}://`) || url.includes("expo-development-client")) return;
        await handleUrl(url);
        await refresh();
      })
      .catch(() => {});
  }, [isConfigured, refresh]);

  const connected = useMemo(
    () => devices.some((d) => (linkStates[d.identifier] ?? d.linkState) === "connected"),
    [devices, linkStates],
  );

  /**
   * One button, next step: register (opens Meta AI), then ask for camera
   * permission (also confirmed in Meta AI), then just refresh.
   */
  const connect = useCallback(async () => {
    if (!isConfigured) {
      throw new Error(
        configError ? `Glasses SDK failed to start: ${configError.message}` : "Glasses SDK is still starting.",
      );
    }
    setBusy(true);
    try {
      const reg = await getRegistrationStateAsync();
      setRegistration(reg);
      if (reg !== "registered") {
        logRef.current("info", "Opening the Meta AI app to register IRL Engine...");
        await startRegistration();
        return;
      }
      const perm: PermissionStatus = await checkPermissionStatus("camera");
      if (perm !== "granted") {
        logRef.current("info", "Asking for glasses camera permission (confirm in Meta AI)...");
        const result = await requestPermission("camera");
        logRef.current(result === "granted" ? "info" : "warn", `Glasses camera permission: ${result}`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [isConfigured, configError, refresh]);

  const waitForSessionStarted = useCallback((id: string) => {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sessionWaitersRef.current = sessionWaitersRef.current.filter((w) => w !== waiter);
        resolve();
      };
      // Resolve on "started" (or a terminal state, so the next call surfaces the real error).
      const waiter = (sid: string, s: DeviceSessionState) => {
        if (sid === id && (s === "started" || s === "stopped")) done();
      };
      const timer = setTimeout(done, SESSION_START_TIMEOUT_MS);
      const current = sessionStatesRef.current[id];
      if (current === "started" || current === "stopped") {
        clearTimeout(timer);
        resolve();
        return;
      }
      sessionWaitersRef.current.push(waiter);
    });
  }, []);

  /** createSession -> startSession -> addStreamToSession. Photos need the stream. */
  const startStreamOnce = useCallback(
    async (resolution: StreamingResolution) => {
      if (sessionRef.current) return;
      if (!isConfigured) throw new Error("Glasses SDK is still starting.");
      const reg = await getRegistrationStateAsync();
      setRegistration(reg);
      if (reg !== "registered") throw new Error("Glasses not registered. Tap Connect glasses first.");

      let perm: PermissionStatus = await checkPermissionStatus("camera");
      if (perm !== "granted") perm = await requestPermission("camera");
      if (perm !== "granted") throw new Error("Glasses camera permission not granted (approve it in Meta AI).");

      const id = await createSession();
      sessionRef.current = id;
      setSessionId(id);
      setSessionState("idle");
      try {
        await startSession(id);
        await waitForSessionStarted(id);
        if (sessionRef.current !== id) throw new Error("Glasses session stopped while starting.");
        await addStreamToSession(id, {
          videoCodec: "raw",
          resolution,
          frameRate: 15,
        });
        logRef.current("info", `Glasses stream started (${resolution}).`);
      } catch (err) {
        await removeStreamFromSession(id).catch(() => {});
        await stopSession(id).catch(() => {});
        if (sessionRef.current === id) {
          sessionRef.current = null;
          setSessionId(null);
          setSessionState(null);
        }
        throw err;
      }
    },
    [isConfigured, waitForSessionStarted],
  );

  /**
   * Single-flight: a second call while one is starting (e.g. the app was
   * backgrounded while Meta AI asked for permission, then resumed) shares the
   * first call's promise instead of creating a second session.
   */
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const startStream = useCallback(
    (resolution: StreamingResolution): Promise<void> => {
      if (startPromiseRef.current) return startPromiseRef.current;
      const p = startStreamOnce(resolution).finally(() => {
        startPromiseRef.current = null;
      });
      startPromiseRef.current = p;
      return p;
    },
    [startStreamOnce],
  );

  const stopStream = useCallback(async () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    setSessionId(null);
    setSessionState(null);
    const pending = pendingRef.current;
    if (pending) {
      clearTimeout(pending.timer);
      pendingRef.current = null;
      pending.reject(new Error("Stream stopped."));
    }
    if (!id) return;
    // Remove the stream first: the native module only forgets a stream when
    // it's removed explicitly (see onDeviceSessionStateChange above).
    await removeStreamFromSession(id).catch(() => {});
    await stopSession(id).catch(() => {});
  }, []);

  /** Ask the glasses for a JPEG and wait for it to land on disk. */
  const capture = useCallback((): Promise<CapturedPhoto> => {
    return new Promise<CapturedPhoto>((resolve, reject) => {
      if (pendingRef.current) {
        reject(new Error("A photo is already being taken."));
        return;
      }
      const timer = setTimeout(() => {
        if (pendingRef.current?.timer === timer) pendingRef.current = null;
        reject(new Error(`No photo from the glasses after ${CAPTURE_TIMEOUT_MS / 1000}s.`));
      }, CAPTURE_TIMEOUT_MS);
      pendingRef.current = { resolve, reject, timer, startedAt: Date.now() };
      capturePhoto("jpeg").catch((err: unknown) => {
        if (pendingRef.current?.timer !== timer) return;
        clearTimeout(timer);
        pendingRef.current = null;
        reject(new Error(`Capture failed: ${errorText(err)}`));
      });
    });
  }, []);

  /**
   * Debug builds only: a simulated pair of glasses whose camera is the
   * phone's back camera. Per Meta's Mock Device Kit docs, photo capture with a
   * phone-camera feed returns a live still from that camera, so no
   * mockDeviceSetCapturedImage() is needed.
   */
  const enableTestMode = useCallback(async () => {
    if (!__DEV__) throw new Error("Test mode only exists in development builds.");
    setBusy(true);
    try {
      await stopStream();
      // The mock camera reads the phone camera, so the app needs iOS camera
      // permission before the camera source is selected.
      const cam = await Camera.requestCameraPermissionsAsync();
      if (!cam.granted) throw new Error("Phone camera permission denied (iOS Settings > IRL Engine > Camera).");
      await enableMockDeviceKit({ initiallyRegistered: true, initialPermissionsGranted: true });
      const id = await pairMockDevice();
      mockIdRef.current = id;
      // A fresh mock device may start powered off / folded / not worn.
      for (const step of [mockDevicePowerOn, mockDeviceUnfold, mockDeviceDon]) {
        try {
          await step(id);
        } catch {
          // Already in that state.
        }
      }
      await mockDeviceSetCameraFeedFromCamera(id, "back");
      setTestMode(true);
      logRef.current("info", "Test mode on: the phone's back camera acts as the glasses.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, stopStream]);

  const disableTestMode = useCallback(async () => {
    setBusy(true);
    try {
      await stopStream();
      if (mockIdRef.current) await unpairMockDevice(mockIdRef.current).catch(() => {});
      mockIdRef.current = null;
      await disableMockDeviceKit().catch(() => {});
      setTestMode(false);
      logRef.current("info", "Test mode off.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, stopStream]);

  // Leave nothing running if the screen unmounts.
  useEffect(() => {
    return () => {
      const id = sessionRef.current;
      if (id) {
        removeStreamFromSession(id).catch(() => {});
        stopSession(id).catch(() => {});
      }
    };
  }, []);

  return {
    isConfigured,
    configError,
    registration,
    permission: permissionStatus,
    connected,
    devices,
    sessionId,
    sessionState,
    streamState,
    isStreaming: sessionId !== null && streamState === "streaming",
    testMode,
    busy,
    connect,
    startStream,
    stopStream,
    capture,
    enableTestMode,
    disableTestMode,
    refresh,
  };
}

export type Glasses = ReturnType<typeof useGlasses>;
