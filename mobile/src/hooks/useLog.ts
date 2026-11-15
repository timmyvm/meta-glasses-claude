import { useCallback, useState } from "react";

export type LogLevel = "info" | "warn" | "error";

export type LogLine = {
  id: number;
  time: string;
  level: LogLevel;
  text: string;
  /** How many times this exact line repeated in a row. */
  count: number;
};

const MAX_LINES = 40;
let nextId = 1;

function clock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** On-screen log, newest first. Identical consecutive lines collapse into one with a counter. */
export function useLog() {
  const [lines, setLines] = useState<LogLine[]>([]);

  const add = useCallback((level: LogLevel, text: string) => {
    if (__DEV__) console.log(`[${level}] ${text}`);
    setLines((prev) => {
      const top = prev[0];
      if (top && top.text === text && top.level === level) {
        return [{ ...top, time: clock(), count: top.count + 1 }, ...prev.slice(1)];
      }
      return [{ id: nextId++, time: clock(), level, text, count: 1 }, ...prev].slice(0, MAX_LINES);
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  return { lines, add, clear };
}
