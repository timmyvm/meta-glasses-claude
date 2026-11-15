import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../settings";

/** Settings state that loads once on mount and saves (debounced) on every change. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const savedTokenRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((s) => {
      if (cancelled) return;
      savedTokenRef.current = s.token;
      setSettings(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      saveSettings(settings, savedTokenRef.current)
        .then(() => {
          savedTokenRef.current = settings.token;
        })
        .catch(() => {
          // Storage failures are rare and non-fatal; the in-memory value still works.
        });
    }, 400);
    return () => clearTimeout(t);
  }, [settings, loaded]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, loaded, update };
}
