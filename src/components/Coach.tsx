"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BoardView } from "@/components/BoardView";
import { VideoPanel } from "@/components/VideoPanel";
import type { ReadBoardResponse, ReadEffort } from "@/lib/api-types";
import {
  decide,
  gameStatus,
  placementOf,
  pvToSan,
  rowsToPlacement,
  turnOf,
  uciToSan,
  type Side,
} from "@/lib/board";
import { Engine } from "@/lib/engine";
import {
  changedFraction,
  createTicker,
  grabJpeg,
  signature,
  sourceReady,
  type FrameSource,
  type Roi,
} from "@/lib/frames";
import { describeScore, sanToSpeech, speak, speechSupported } from "@/lib/speech";

// ---------- settings ----------

type Prefs = {
  viewer: Side;
  auto: boolean;
  voice: boolean;
  voiceURI: string;
  rate: number;
  effort: ReadEffort;
  movetime: number; // ms of Stockfish thinking
  minGap: number; // seconds between automatic reads
  rotated: boolean;
};

const DEFAULT_PREFS: Prefs = {
  viewer: "w",
  auto: true,
  voice: true,
  voiceURI: "",
  rate: 1.05,
  effort: "medium",
  movetime: 1500,
  minGap: 4,
  rotated: false,
};

const PREFS_KEY = "irl-engine:prefs";

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // storage blocked (private window etc.), fall back to defaults
  }
  return DEFAULT_PREFS;
}

// Auto-watch tuning: how still the picture must be, and how much it must
// differ from the last read, before we spend an API call on it.
const TICK_MS = 400;
const MOTION_LIMIT = 0.02; // >2% of thumbnail pixels changing = camera/hand moving
const STABLE_MS = 900; // must be still this long
const CHANGE_MIN = 0.004; // vs. last read frame, else assume nothing happened

// ---------- types ----------

type Phase = "idle" | "watching" | "reading" | "thinking" | "speaking";

type Suggestion = {
  fen: string;
  uci: string;
  san: string;
  spoken: string;
  score: string;
  depth: number;
  line: string[];
};

type LogEntry = { id: number; time: string; kind: "info" | "move" | "warn" | "error"; text: string };

let logId = 0;

// ---------- component ----------

export default function Coach() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [roi, setRoi] = useState<Roi | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [engineReady, setEngineReady] = useState(false);
  const [gameFen, setGameFen] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [lastRead, setLastRead] = useState<{ ms: number; confidence: string; model: string } | null>(null);
  const [motion, setMotion] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [fenInput, setFenInput] = useState("");

  const prefsRef = useRef(prefs);
  const roiRef = useRef<Roi | null>(null);
  const sourceRef = useRef<FrameSource | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const gameFenRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const lastReqAtRef = useRef(0);
  const lastReadSigRef = useRef<Uint8ClampedArray | null>(null);
  const pendingUnknownRef = useRef<string | null>(null);
  const recheckRef = useRef(false); // let auto-watch re-read even if the picture hasn't changed
  const queuedManualRef = useRef(false);
  const readBoardRef = useRef<(trigger: "auto" | "manual") => Promise<void>>(async () => {});
  const suggestionRef = useRef<Suggestion | null>(null);

  useEffect(() => {
    prefsRef.current = prefs;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);
  useEffect(() => {
    roiRef.current = roi;
  }, [roi]);
  useEffect(() => {
    suggestionRef.current = suggestion;
  }, [suggestion]);

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((l) => [{ id: ++logId, time, kind, text }, ...l].slice(0, 50));
  }, []);

  const idlePhase = useCallback((): Phase => (prefsRef.current.auto ? "watching" : "idle"), []);

  const say = useCallback(async (text: string) => {
    const p = prefsRef.current;
    if (!p.voice) return;
    setPhase("speaking");
    await speak(text, { voiceURI: p.voiceURI || undefined, rate: p.rate });
  }, []);

  const setGame = useCallback((fen: string | null) => {
    gameFenRef.current = fen;
    setGameFen(fen);
  }, []);

  // ---------- engine ----------

  useEffect(() => {
    const engine = new Engine();
    engineRef.current = engine;
    engine.init().then(
      () => setEngineReady(true),
      (e) => addLog("error", `Stockfish failed to load: ${String(e)}`),
    );
    return () => {
      engine.terminate();
      engineRef.current = null;
    };
  }, [addLog]);

  useEffect(() => {
    if (!speechSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    const t = setTimeout(load, 0);
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      clearTimeout(t);
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);

  /** Run Stockfish on a position where it's the wearer's move, then say it. */
  const suggest = useCallback(
    async (fen: string) => {
      const status = gameStatus(fen);
      if (status.kind === "invalid") {
        addLog("warn", "That position isn't legal, skipping (misread?)");
        return;
      }
      if (status.kind === "checkmate" || status.kind === "stalemate") {
        addLog("info", status.kind === "checkmate" ? "Checkmate on the board" : "Stalemate");
        setSuggestion(null);
        await say(status.kind === "checkmate" ? "Checkmate" : "Stalemate");
        return;
      }
      const engine = engineRef.current;
      if (!engine) return;

      const seq = ++seqRef.current;
      setPhase("thinking");
      const a = await engine.analyze(fen, prefsRef.current.movetime);
      if (seq !== seqRef.current || !a.bestmove) return;

      const san = uciToSan(fen, a.bestmove) ?? a.bestmove;
      const score = describeScore(a.scoreCp, a.mate);
      const next: Suggestion = {
        fen,
        uci: a.bestmove,
        san,
        spoken: sanToSpeech(san),
        score,
        depth: a.depth,
        line: pvToSan(fen, a.pv),
      };
      setSuggestion(next);
      addLog("move", `Best: ${san}${score ? ` (${score})` : ""}, depth ${a.depth}`);
      await say(next.spoken);
    },
    [addLog, say],
  );

  // ---------- reading the board ----------

  const readBoard = useCallback(
    async (trigger: "auto" | "manual") => {
      const src = sourceRef.current;
      if (!sourceReady(src)) {
        if (trigger === "manual") addLog("warn", "No video or image to read yet");
        return;
      }
      if (busyRef.current) {
        if (trigger === "manual") queuedManualRef.current = true;
        return;
      }
      busyRef.current = true;
      recheckRef.current = false;
      lastReqAtRef.current = performance.now();
      const p = prefsRef.current;
      setPhase("reading");

      try {
        lastReadSigRef.current = signature(src, roiRef.current);
        const frame = grabJpeg(src, roiRef.current);
        const res = await fetch("/api/read-board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frame.base64, viewer: p.viewer, effort: p.effort }),
        });
        const data = (await res.json()) as ReadBoardResponse;
        if (!data.ok) {
          addLog("error", data.error);
          recheckRef.current = true;
          return;
        }
        setLastRead({ ms: data.ms, confidence: data.confidence, model: data.model });
        if (!data.visible) {
          if (trigger === "manual") addLog("info", `Can't see the board clearly${data.notes ? `: ${data.notes}` : ""}`);
          return;
        }

        const parsed = rowsToPlacement(data.rows, p.viewer, p.rotated);
        if (!parsed.ok) {
          addLog("warn", `Misread: ${parsed.error}`);
          recheckRef.current = true;
          return;
        }
        setSeen(parsed.placement);

        const d = decide(gameFenRef.current, parsed.placement, p.viewer, trigger === "manual");

        // A board that doesn't follow from the last one by a legal move is
        // often a half-finished move or a misread. In auto mode, wait for the
        // same board twice before believing it.
        if (d.how === "unknown" && trigger === "auto" && pendingUnknownRef.current !== parsed.placement) {
          pendingUnknownRef.current = parsed.placement;
          recheckRef.current = true;
          addLog("info", "Board changed unexpectedly, double-checking");
          return;
        }
        pendingUnknownRef.current = null;

        const changed = d.how !== "same" || d.fen !== gameFenRef.current;
        setGame(d.fen);
        if (d.moves.length) {
          const m = d.moves[d.moves.length - 1];
          setLastMove({ from: m.from, to: m.to });
        } else if (d.how !== "same") {
          setLastMove(null);
        }
        if (changed || trigger === "manual") {
          addLog(d.how === "unknown" ? "warn" : "info", `${d.note}${data.confidence !== "high" ? ` (${data.confidence} confidence)` : ""}`);
        }

        if (d.myTurn) {
          const current = suggestionRef.current;
          if (changed || !current || current.fen !== d.fen) {
            await suggest(d.fen);
          } else if (trigger === "manual") {
            await say(current.spoken);
          }
        } else if (changed) {
          setSuggestion(null);
        }
      } catch (e) {
        addLog("error", e instanceof Error ? e.message : String(e));
        recheckRef.current = true;
      } finally {
        busyRef.current = false;
        setPhase(idlePhase());
        // Someone pressed "Read board" while we were busy: do it now.
        if (queuedManualRef.current) {
          queuedManualRef.current = false;
          setTimeout(() => void readBoardRef.current("manual"), 0);
        }
      }
    },
    [addLog, idlePhase, say, setGame, suggest],
  );
  useEffect(() => {
    readBoardRef.current = readBoard;
  }, [readBoard]);

  // ---------- auto watch loop ----------

  const hasVideo = Boolean(stream);
  useEffect(() => {
    if (!prefs.auto || !hasVideo) return;
    let prevSig: Uint8ClampedArray | null = null;
    let stableSince = performance.now();
    let ticks = 0;
    const stop = createTicker(TICK_MS, () => {
      const src = sourceRef.current;
      if (!sourceReady(src)) return;
      const sig = signature(src, roiRef.current);
      const now = performance.now();
      const m = prevSig ? changedFraction(sig, prevSig) : 1;
      prevSig = sig;
      if (++ticks % 2 === 0) setMotion(m);

      if (m > MOTION_LIMIT) {
        stableSince = now;
        return;
      }
      if (now - stableSince < STABLE_MS) return;
      if (busyRef.current) return;
      if (now - lastReqAtRef.current < prefsRef.current.minGap * 1000) return;
      const last = lastReadSigRef.current;
      if (!recheckRef.current && last && changedFraction(sig, last) < CHANGE_MIN) return;
      void readBoard("auto");
    });
    return stop;
  }, [prefs.auto, hasVideo, readBoard]);

  const phaseNow: Phase =
    phase === "idle" || phase === "watching" ? (prefs.auto && hasVideo ? "watching" : "idle") : phase;

  // ---------- keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        void readBoard("manual");
      } else if (e.key === "r" || e.key === "R") {
        const s = suggestionRef.current;
        if (s) void say(s.spoken).then(() => setPhase(idlePhase()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idlePhase, readBoard, say]);

  // ---------- sources ----------

  const attach = (next: MediaStream) => {
    stream?.getTracks().forEach((t) => t.stop());
    next.getVideoTracks()[0]?.addEventListener("ended", () => {
      setStream((s) => (s === next ? null : s));
      addLog("info", "Screen share stopped");
    });
    setImageUrl(null);
    setStream(next);
  };

  const shareWindow = async () => {
    try {
      // Ask for as many pixels as the window has; the browser never upscales,
      // so this just stops it from capturing at a reduced size.
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      const track = s.getVideoTracks()[0];
      if (track) track.contentHint = "detail";
      attach(s);
      const { width, height } = track?.getSettings() ?? {};
      addLog("info", `Sharing the call window${width && height ? ` at ${width}×${height}` : ""}. Drag on the video to crop to the board.`);
      if (width && height && Math.min(width, height) < 600) {
        addLog("warn", "That's a small capture. Make the call window bigger for a sharper board.");
      }
    } catch (e) {
      addLog("warn", `Screen share cancelled: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const useWebcam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      attach(s);
      addLog("info", "Using a webcam (handy for testing without the glasses)");
    } catch (e) {
      addLog("warn", `Webcam unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    addLog("info", `Loaded ${file.name}. Press "Read board" to analyse it.`);
  };

  const stopSource = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    sourceRef.current = null;
  };

  const resetGame = () => {
    seqRef.current++;
    setGame(null);
    setSeen(null);
    setSuggestion(null);
    setLastMove(null);
    pendingUnknownRef.current = null;
    lastReadSigRef.current = null;
    addLog("info", "Game reset. Next read starts fresh.");
  };

  const analyseFen = async () => {
    const fen = fenInput.trim();
    if (gameStatus(fen).kind === "invalid") {
      addLog("warn", "That FEN isn't valid");
      return;
    }
    setGame(fen);
    setSeen(placementOf(fen));
    setLastMove(null);
    addLog("info", `Loaded FEN (${turnOf(fen) === "w" ? "White" : "Black"} to move)`);
    await suggest(fen);
    setPhase(idlePhase());
  };

  // ---------- render ----------

  const placement = gameFen ? placementOf(gameFen) : seen;
  const myTurn = gameFen ? turnOf(gameFen) === prefs.viewer : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            IRL Engine <span className="text-zinc-500">· glasses chess</span>
          </h1>
          <p className="text-xs text-zinc-500">Meta glasses video call → Claude reads the board → Stockfish → spoken in your ear</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Pill tone={engineReady ? "ok" : "wait"}>{engineReady ? "Stockfish ready" : "Loading Stockfish…"}</Pill>
          <PhasePill phase={phaseNow} />
        </div>
      </header>

      <div className="grid flex-1 content-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr]">
        {/* ---------- left: video ---------- */}
        <section className="flex min-w-0 flex-col gap-3">
          <VideoPanel
            stream={stream}
            imageUrl={imageUrl}
            roi={roi}
            onRoiChange={setRoi}
            onElement={(el) => {
              sourceRef.current = el;
            }}
            overlay={
              hasVideo && prefs.auto ? (
                <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
                  <span>motion</span>
                  <span className="h-1.5 w-20 overflow-hidden rounded bg-zinc-700">
                    <span
                      className={`block h-full ${motion > MOTION_LIMIT ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.min(100, (motion / (MOTION_LIMIT * 3)) * 100)}%` }}
                    />
                  </span>
                </div>
              ) : null
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={shareWindow} primary>
              Share call window
            </Button>
            <Button onClick={useWebcam}>Use webcam</Button>
            <label className="cursor-pointer rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {(stream || imageUrl) && <Button onClick={stopSource}>Stop</Button>}
            {roi && <Button onClick={() => setRoi(null)}>Clear crop</Button>}
            <span className="text-xs text-zinc-500">Tip: drag on the video to crop to the board</span>
          </div>

        </section>

        {/* ---------- right: move + board + settings ---------- */}
        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-white/5">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{myTurn === null ? "Waiting for a board" : myTurn ? "Your move" : "Opponent to move"}</span>
              {suggestion && <span>depth {suggestion.depth}</span>}
            </div>
            <div className="mt-1 min-h-[3.25rem]">
              {suggestion ? (
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-4xl font-semibold tracking-tight text-emerald-300" data-testid="best-move">
                    {suggestion.san}
                  </div>
                  <div className="font-mono text-lg text-zinc-300">{suggestion.score}</div>
                </div>
              ) : (
                <div className="text-2xl text-zinc-600">{phaseNow === "thinking" ? "Thinking…" : "—"}</div>
              )}
            </div>
            {suggestion && (
              <>
                <p className="mt-1 text-sm text-zinc-400" data-testid="spoken">
                  “{suggestion.spoken}”
                </p>
                {suggestion.line.length > 1 && (
                  <p className="mt-1 truncate font-mono text-xs text-zinc-500">line: {suggestion.line.join(" ")}</p>
                )}
              </>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button primary onClick={() => void readBoard("manual")}>
                Read board <Kbd>Space</Kbd>
              </Button>
              <Button
                onClick={() => suggestion && void say(suggestion.spoken).then(() => setPhase(idlePhase()))}
                disabled={!suggestion}
              >
                Say again <Kbd>R</Kbd>
              </Button>
            </div>
          </div>

          <BoardView
            placement={placement}
            orientation={prefs.viewer}
            highlight={suggestion && suggestion.fen === gameFen ? suggestion.uci : null}
            lastMove={lastMove}
          />

          <div className="space-y-3 rounded-xl bg-zinc-900/70 p-4 text-sm ring-1 ring-white/5">
            <Row label="I'm playing">
              <Segmented
                value={prefs.viewer}
                options={[
                  ["w", "White"],
                  ["b", "Black"],
                ]}
                onChange={(v) => set("viewer", v as Side)}
              />
            </Row>
            <Row label="Auto-watch" hint="reads the board when it changes and the picture is still">
              <Toggle checked={prefs.auto} onChange={(v) => set("auto", v)} />
            </Row>
            <Row label="Speak moves">
              <Toggle checked={prefs.voice} onChange={(v) => set("voice", v)} />
            </Row>
            <Row label="Read quality" hint="higher reads more carefully but is slower">
              <Segmented
                value={prefs.effort}
                options={[
                  ["low", "Fast"],
                  ["medium", "Balanced"],
                  ["high", "Careful"],
                ]}
                onChange={(v) => set("effort", v as ReadEffort)}
              />
            </Row>
            <Row label={`Engine time ${(prefs.movetime / 1000).toFixed(1)}s`}>
              <input
                type="range"
                min={200}
                max={5000}
                step={100}
                value={prefs.movetime}
                onChange={(e) => set("movetime", Number(e.target.value))}
                className="w-36 accent-emerald-400"
              />
            </Row>
            <Row label={`Min gap ${prefs.minGap}s`} hint="between automatic reads (each read is an API call)">
              <input
                type="range"
                min={2}
                max={15}
                step={1}
                value={prefs.minGap}
                onChange={(e) => set("minGap", Number(e.target.value))}
                className="w-36 accent-emerald-400"
              />
            </Row>
            <Row label="Voice">
              <select
                value={prefs.voiceURI}
                onChange={(e) => set("voiceURI", e.target.value)}
                className="w-44 truncate rounded-md bg-zinc-800 px-2 py-1 text-xs"
              >
                <option value="">System default</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </Row>
            <Row label={`Speech rate ${prefs.rate.toFixed(2)}×`}>
              <input
                type="range"
                min={0.7}
                max={1.6}
                step={0.05}
                value={prefs.rate}
                onChange={(e) => set("rate", Number(e.target.value))}
                className="w-36 accent-emerald-400"
              />
            </Row>
            <Row label="Board looks flipped" hint="use if reads come out upside down">
              <Toggle checked={prefs.rotated} onChange={(v) => set("rotated", v)} />
            </Row>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => void say("Knight F3. Testing, one two.").then(() => setPhase(idlePhase()))}>
                Test voice
              </Button>
              <Button onClick={resetGame}>New game</Button>
            </div>
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-zinc-500">Debug: analyse a FEN</summary>
              <div className="mt-2 flex gap-2">
                <input
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  placeholder="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
                  className="min-w-0 flex-1 rounded-md bg-zinc-800 px-2 py-1 font-mono text-xs"
                  data-testid="fen-input"
                />
                <Button onClick={() => void analyseFen()} disabled={!engineReady}>
                  Go
                </Button>
              </div>
              {gameFen && <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{gameFen}</p>}
            </details>
          </div>
        </aside>

        {/* ---------- log (under the video on desktop, last on mobile) ---------- */}
        <div className="rounded-xl bg-zinc-900/70 p-3 ring-1 ring-white/5 lg:col-start-1 lg:row-start-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Log</h2>
            {lastRead && (
              <span className="text-[11px] text-zinc-500">
                last read {(lastRead.ms / 1000).toFixed(1)}s · {lastRead.confidence} · {lastRead.model}
              </span>
            )}
          </div>
          <ol className="max-h-56 space-y-1 overflow-y-auto font-mono text-xs">
            {log.length === 0 && <li className="text-zinc-600">Nothing yet.</li>}
            {log.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="shrink-0 text-zinc-600">{l.time}</span>
                <span
                  className={
                    l.kind === "error"
                      ? "text-red-400"
                      : l.kind === "warn"
                        ? "text-amber-300"
                        : l.kind === "move"
                          ? "text-emerald-300"
                          : "text-zinc-300"
                  }
                >
                  {l.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}

// ---------- small UI bits ----------

function Button({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        primary ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] opacity-70">{children}</kbd>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-zinc-200">{label}</div>
        {hint && <div className="text-[11px] leading-tight text-zinc-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-emerald-500" : "bg-zinc-700"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-800 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs transition ${value === v ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "wait" | "busy" | "off"; children: React.ReactNode }) {
  const tones = {
    ok: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    wait: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
    busy: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    off: "bg-zinc-800 text-zinc-400 ring-white/10",
  };
  return <span className={`rounded-full px-2.5 py-1 ring-1 ${tones[tone]}`}>{children}</span>;
}

function PhasePill({ phase }: { phase: Phase }) {
  const map: Record<Phase, [string, "ok" | "wait" | "busy" | "off"]> = {
    idle: ["Idle", "off"],
    watching: ["Watching", "ok"],
    reading: ["Reading board…", "busy"],
    thinking: ["Stockfish thinking…", "busy"],
    speaking: ["Speaking", "busy"],
  };
  const [label, tone] = map[phase];
  return (
    <span data-testid="phase">
      <Pill tone={tone}>{label}</Pill>
    </span>
  );
}
