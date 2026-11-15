/**
 * Game tracker: a pure "reducer" that takes the tracked state plus one board
 * read and decides what happened. Shared by the browser app and the phone
 * endpoint so both behave the same.
 *
 * - First read (or after losing track): a full read with piece types.
 * - While tracking: an occupancy read (light / dark / empty per square),
 *   matched against the legal moves from the tracked position.
 * - A move only counts once two reads in a row agree on it (auto mode).
 * - After LOST_AFTER reads in a row that fit no legal move, say so out loud
 *   and fall back to a full read.
 */

import {
  decide,
  matchOccupancy,
  rowsToOccupancy,
  rowsToPlacement,
  turnOf,
  withTurn,
  type Side,
} from "./board";

export const LOST_AFTER = 3;
export const LOST_NOTICE = "Lost track of the board. Look at it straight on.";

export type ReadMode = "full" | "occupancy";

export type TrackerState = {
  /** Committed game position, null before the first good read. */
  fen: string | null;
  /** A move seen once, waiting for a second read to agree. */
  pending: { key: string; fen: string; note: string; lastMove: { from: string; to: string } } | null;
  /** Full-mode board that didn't follow by a legal move, waiting to be seen again. */
  pendingUnknown: string | null;
  /** Reads in a row that fit no legal continuation. */
  misses: number;
  /** Next read should be a full read to resync. */
  lost: boolean;
};

export const NEW_GAME: TrackerState = { fen: null, pending: null, pendingUnknown: null, misses: 0, lost: false };

export function readModeFor(state: TrackerState): ReadMode {
  return state.fen && !state.lost ? "occupancy" : "full";
}

export type Observation =
  | { kind: "unreadable"; notes: string }
  | { kind: "rows"; mode: ReadMode; rows: string[]; confidence: "high" | "medium" | "low" };

export type StepOptions = { viewer: Side; rotated: boolean; trigger: "auto" | "manual" };

export type TrackResult = {
  state: TrackerState;
  log: { level: "info" | "warn"; text: string }[];
  /** Run the engine on this position (it's the wearer's move and it's new). */
  analyze: string | null;
  /** Wearer asked again and nothing changed: repeat the last suggestion. */
  repeat: boolean;
  /** Speak this notice (not a move). */
  notice: string | null;
  /** Opponent to move now: drop the old suggestion. */
  clearSuggestion: boolean;
  /** undefined = unchanged, null = clear the highlight. */
  lastMove: { from: string; to: string } | null | undefined;
  myTurn: boolean | null;
  /** Read again soon without waiting for the picture to change. */
  recheck: boolean;
};

export function trackStep(prev: TrackerState, obs: Observation, opts: StepOptions): TrackResult {
  const manual = opts.trigger === "manual";
  const out: TrackResult = {
    state: { ...prev },
    log: [],
    analyze: null,
    repeat: false,
    notice: null,
    clearSuggestion: false,
    lastMove: undefined,
    myTurn: prev.fen ? turnOf(prev.fen) === opts.viewer : null,
    recheck: false,
  };
  const s = out.state;
  const info = (text: string) => out.log.push({ level: "info", text });
  const warn = (text: string) => out.log.push({ level: "warn", text });

  const miss = (why: string) => {
    s.misses += 1;
    s.pending = null;
    if (s.fen && !s.lost && s.misses >= LOST_AFTER) {
      s.lost = true;
      out.notice = LOST_NOTICE;
      warn(`Lost track (${why}). Next read is a full read.`);
    } else {
      warn(`Couldn't match the board: ${why}`);
      out.recheck = true;
    }
  };

  if (obs.kind === "unreadable") {
    // Hands over the board and looking away are normal; only report on request.
    if (manual) info(`Can't see the board clearly${obs.notes ? `: ${obs.notes.replace(/\.\s*$/, "")}` : ""}`);
    return out;
  }

  const lowConfidence = obs.confidence !== "high" ? ` (${obs.confidence} confidence)` : "";

  // ---------- full read: piece types, used to start or resync ----------
  if (obs.mode === "full") {
    const parsed = rowsToPlacement(obs.rows, opts.viewer, opts.rotated);
    if (!parsed.ok) {
      miss(`misread, ${parsed.error}`);
      return out;
    }
    const d = decide(prev.fen, parsed.placement, opts.viewer, manual);

    if (d.how === "unknown" && !manual && prev.pendingUnknown !== parsed.placement) {
      s.pendingUnknown = parsed.placement;
      out.recheck = true;
      info("Board changed unexpectedly, double-checking");
      return out;
    }

    const changed = d.how !== "same" || d.fen !== prev.fen;
    s.fen = d.fen;
    s.pending = null;
    s.pendingUnknown = null;
    s.misses = 0;
    s.lost = false;
    if (d.moves.length) {
      const m = d.moves[d.moves.length - 1];
      out.lastMove = { from: m.from, to: m.to };
    } else if (d.how !== "same") {
      out.lastMove = null;
    }
    if (changed || manual) (d.how === "unknown" ? warn : info)(`${d.note}${lowConfidence}`);
    out.myTurn = d.myTurn;
    if (d.myTurn) {
      if (changed) out.analyze = d.fen;
      else if (manual) out.repeat = true;
    } else if (changed) {
      out.clearSuggestion = true;
    }
    return out;
  }

  // ---------- occupancy read: light / dark / empty ----------
  if (!prev.fen) {
    // Shouldn't happen (no game to match against); resync with a full read.
    s.lost = true;
    out.recheck = true;
    return out;
  }
  const occ = rowsToOccupancy(obs.rows, opts.viewer, opts.rotated);
  if (!occ.ok) {
    miss(`misread, ${occ.error}`);
    return out;
  }
  const m = matchOccupancy(prev.fen, occ.occupancy);

  if (m.kind === "nomatch") {
    miss(m.reason);
    return out;
  }
  s.misses = 0;

  if (m.kind === "same") {
    s.pending = null;
    const myTurn = turnOf(prev.fen) === opts.viewer;
    out.myTurn = myTurn;
    if (manual) {
      if (myTurn) {
        out.repeat = true;
      } else {
        s.fen = withTurn(prev.fen, opts.viewer);
        out.myTurn = true;
        out.analyze = s.fen;
        info("No change seen, treating it as your move");
      }
    }
    return out;
  }

  // A legal move fits what the camera sees.
  const sans = m.moves.map((x) => x.san).join(", ");
  const who = m.moves.length === 2 ? "Saw" : m.lastMover === opts.viewer ? "You played" : "Opponent played";
  const note = `${who} ${sans}`;
  const last = m.moves[m.moves.length - 1];

  if (!manual && prev.pending?.key !== m.key) {
    s.pending = { key: m.key, fen: m.fen, note, lastMove: { from: last.from, to: last.to } };
    out.recheck = true;
    info(`Saw ${sans}?${lowConfidence} Confirming…`);
    return out;
  }

  s.fen = m.fen;
  s.pending = null;
  out.lastMove = { from: last.from, to: last.to };
  out.myTurn = turnOf(m.fen) === opts.viewer;
  info(note);
  if (out.myTurn) out.analyze = m.fen;
  else out.clearSuggestion = true;
  return out;
}
