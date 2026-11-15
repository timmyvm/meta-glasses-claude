import { Chess, type Move } from "chess.js";

export type Side = "w" | "b";

export const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
export const START_FEN = `${START_PLACEMENT} w KQkq - 0 1`;

const PIECES = new Set("PNBRQKpnbrqk".split(""));

/**
 * Clean up one row the vision model returned. Accepts FEN-style digits,
 * '-', '_' or '0' as empty squares and strips whitespace.
 */
export function normalizeRow(row: string): string {
  let out = "";
  for (const ch of row.replace(/\s+/g, "")) {
    if (PIECES.has(ch)) out += ch;
    else if (ch >= "1" && ch <= "8") out += ".".repeat(Number(ch));
    else if (ch === "." || ch === "-" || ch === "_" || ch === "0") out += ".";
    // anything else (commas, quotes) is ignored
  }
  return out;
}

export type PlacementResult =
  | { ok: true; placement: string; ranks: string[] }
  | { ok: false; error: string };

/**
 * Convert rows as seen in the image (far side first, each row left to right)
 * into a FEN piece-placement string.
 *
 * The wearer sits behind their own pieces, so their side is nearest the
 * camera. If they play White, the far row is rank 8 and left is the a-file.
 * If they play Black the whole board is rotated 180 degrees.
 * `rotated` flips that assumption for when the camera sees it the other way.
 */
export function rowsToPlacement(
  rows: string[],
  viewer: Side,
  rotated = false,
): PlacementResult {
  if (rows.length !== 8) {
    return { ok: false, error: `expected 8 rows, got ${rows.length}` };
  }
  const clean = rows.map(normalizeRow);
  const bad = clean.findIndex((r) => r.length !== 8);
  if (bad !== -1) {
    return { ok: false, error: `row ${bad + 1} has ${clean[bad].length} squares` };
  }

  const nearIsWhite = (viewer === "w") !== rotated;
  const ranks = nearIsWhite
    ? clean
    : clean
        .slice()
        .reverse()
        .map((r) => r.split("").reverse().join(""));

  const all = ranks.join("");
  const whiteKings = all.split("K").length - 1;
  const blackKings = all.split("k").length - 1;
  if (whiteKings !== 1 || blackKings !== 1) {
    return {
      ok: false,
      error: `need one king each (saw ${whiteKings} white, ${blackKings} black)`,
    };
  }
  if (/[Pp]/.test(ranks[0]) || /[Pp]/.test(ranks[7])) {
    return { ok: false, error: "pawn on the first or last rank (board misread or flipped?)" };
  }

  return { ok: true, placement: ranksToPlacement(ranks), ranks };
}

/** ["rnbqkbnr", "pppppppp", "........", ...] -> "rnbqkbnr/pppppppp/8/..." */
export function ranksToPlacement(ranks: string[]): string {
  return ranks
    .map((r) => r.replace(/\.+/g, (m) => String(m.length)))
    .join("/");
}

/** "rnbqkbnr/pppppppp/8/..." -> 8 strings of 8 chars, rank 8 first. */
export function placementToRanks(placement: string): string[] {
  return placement
    .split("/")
    .map((r) => r.replace(/\d/g, (d) => ".".repeat(Number(d))));
}

/**
 * Guess castling rights from where the pieces stand. If the king and a rook
 * are still on their starting squares we assume that castle is still legal.
 * Only used when we lose track of the game; normally rights come from history.
 */
export function inferCastling(placement: string): string {
  const ranks = placementToRanks(placement);
  const r1 = ranks[7];
  const r8 = ranks[0];
  let rights = "";
  if (r1[4] === "K") {
    if (r1[7] === "R") rights += "K";
    if (r1[0] === "R") rights += "Q";
  }
  if (r8[4] === "k") {
    if (r8[7] === "r") rights += "k";
    if (r8[0] === "r") rights += "q";
  }
  return rights || "-";
}

export function buildFen(placement: string, turn: Side, castling?: string): string {
  return `${placement} ${turn} ${castling ?? inferCastling(placement)} - 0 1`;
}

export function placementOf(fen: string): string {
  return fen.split(" ")[0];
}

export function turnOf(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

export function withTurn(fen: string, turn: Side): string {
  const parts = fen.split(" ");
  parts[1] = turn;
  // en passant square is only valid for the side that was about to move
  if (parts[3] && parts[3] !== "-" && turn !== turnOf(fen)) parts[3] = "-";
  return parts.join(" ");
}

function tryChess(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export type Inference =
  | { kind: "same" }
  | { kind: "moved"; moves: Move[]; fen: string; lastMover: Side }
  | { kind: "unknown" };

/**
 * Work out what happened between the position we were tracking (`prevFen`)
 * and a freshly read board. Tries every legal move for either side, then
 * every two-move sequence (in case a move happened between camera reads).
 * When it finds a match, the returned FEN carries the correct side to move,
 * castling rights and en passant square from real game history.
 */
export function inferMove(prevFen: string, nextPlacement: string): Inference {
  if (placementOf(prevFen) === nextPlacement) return { kind: "same" };

  const order: Side[] = [turnOf(prevFen), turnOf(prevFen) === "w" ? "b" : "w"];

  // One move by either side.
  for (const side of order) {
    const game = tryChess(withTurn(prevFen, side));
    if (!game) continue;
    for (const move of game.moves({ verbose: true })) {
      game.move(move);
      if (placementOf(game.fen()) === nextPlacement) {
        return { kind: "moved", moves: [move], fen: game.fen(), lastMover: side };
      }
      game.undo();
    }
  }

  // Two moves (one each), in case we missed a frame.
  for (const side of order) {
    const game = tryChess(withTurn(prevFen, side));
    if (!game) continue;
    for (const first of game.moves({ verbose: true })) {
      game.move(first);
      for (const second of game.moves({ verbose: true })) {
        game.move(second);
        if (placementOf(game.fen()) === nextPlacement) {
          return {
            kind: "moved",
            moves: [first, second],
            fen: game.fen(),
            lastMover: side === "w" ? "b" : "w",
          };
        }
        game.undo();
      }
      game.undo();
    }
  }

  return { kind: "unknown" };
}

/** Castling rights only ever disappear, so keep the ones both sources allow. */
function intersectCastling(a: string, b: string): string {
  const out = "KQkq"
    .split("")
    .filter((c) => a.includes(c) && b.includes(c))
    .join("");
  return out || "-";
}

export type Decision = {
  fen: string;
  myTurn: boolean;
  /** start | same | moved | fresh (first read mid-game) | unknown (lost track) */
  how: "start" | "same" | "moved" | "fresh" | "unknown";
  note: string;
  moves: Move[];
};

/**
 * Given the position we were tracking and a fresh board read, decide the new
 * game state and whether it's the wearer's move.
 * `force` = the wearer explicitly asked for a move: if nothing changed, treat
 * it as their turn (the tracker may have the turn wrong).
 */
export function decide(
  prevFen: string | null,
  placement: string,
  mine: Side,
  force: boolean,
): Decision {
  if (!prevFen) {
    if (placement === START_PLACEMENT) {
      if (force && mine === "b") {
        return { fen: withTurn(START_FEN, "b"), myTurn: true, how: "start", note: "Starting position (forced Black to move)", moves: [] };
      }
      return { fen: START_FEN, myTurn: mine === "w", how: "start", note: "Starting position", moves: [] };
    }
    return {
      fen: buildFen(placement, mine),
      myTurn: true,
      how: "fresh",
      note: "Picked up a game in progress, assuming it's your move",
      moves: [],
    };
  }

  const inf = inferMove(prevFen, placement);

  if (inf.kind === "same") {
    const myTurn = turnOf(prevFen) === mine;
    if (force && !myTurn) {
      return { fen: withTurn(prevFen, mine), myTurn: true, how: "same", note: "No change seen, treating it as your move", moves: [] };
    }
    return { fen: prevFen, myTurn, how: "same", note: "No change", moves: [] };
  }

  if (inf.kind === "moved") {
    // A legal move was seen, so trust it over `force`: if the wearer just
    // moved, suggesting another move for them would be nonsense.
    const myTurn = turnOf(inf.fen) === mine;
    const sans = inf.moves.map((m) => m.san).join(", ");
    const who = inf.moves.length === 2 ? "Saw" : inf.lastMover === mine ? "You played" : "Opponent played";
    return { fen: inf.fen, myTurn, how: "moved", note: `${who} ${sans}`, moves: inf.moves };
  }

  const castling = intersectCastling(prevFen.split(" ")[2] ?? "-", inferCastling(placement));
  return {
    fen: buildFen(placement, mine, castling),
    myTurn: true,
    how: "unknown",
    note: "Lost track of the game, assuming it's your move",
    moves: [],
  };
}

/** Is the position playable (legal FEN with at least one legal move)? */
export function gameStatus(fen: string):
  | { kind: "invalid" }
  | { kind: "checkmate" }
  | { kind: "stalemate" }
  | { kind: "playing"; inCheck: boolean } {
  const game = tryChess(fen);
  if (!game) return { kind: "invalid" };
  if (game.isCheckmate()) return { kind: "checkmate" };
  if (game.isStalemate()) return { kind: "stalemate" };
  return { kind: "playing", inCheck: game.inCheck() };
}

/** UCI (e2e4, e7e8q) -> SAN (e4, e8=Q) for the given position. */
export function uciToSan(fen: string, uci: string): string | null {
  const game = tryChess(fen);
  if (!game) return null;
  try {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move.san;
  } catch {
    return null;
  }
}

/** Play a UCI principal variation forward and return the SAN moves. */
export function pvToSan(fen: string, pv: string[], max = 6): string[] {
  const game = tryChess(fen);
  if (!game) return [];
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occupancy tracking: once the game is being followed, the camera only has to
// say which squares hold a light piece, a dark piece, or nothing. That's far
// easier to read from a blurry photo than telling a knight from a bishop, and
// the legal-move list fills in the rest.
// ---------------------------------------------------------------------------

/** 64 chars in FEN order (a8..h8, a7..h7, ..., a1..h1): "W" light, "B" dark, "." empty. */
export type Occupancy = string;

export function occupancyOf(placement: string): Occupancy {
  return placementToRanks(placement)
    .join("")
    .replace(/[PNBRQK]/g, "W")
    .replace(/[pnbrqk]/g, "B");
}

/** Clean one occupancy row: W/B (any case) for pieces, ".", "-", "_", "0" or digits for empty. */
export function normalizeOccupancyRow(row: string): string | null {
  let out = "";
  for (const ch of row.replace(/\s+/g, "")) {
    if (ch === "W" || ch === "w") out += "W";
    else if (ch === "B" || ch === "b") out += "B";
    else if (ch >= "1" && ch <= "8") out += ".".repeat(Number(ch));
    else if (ch === "." || ch === "-" || ch === "_" || ch === "0") out += ".";
    else if (ch === "," || ch === "'" || ch === '"') continue;
    else return null;
  }
  return out;
}

export type OccupancyResult = { ok: true; occupancy: Occupancy } | { ok: false; error: string };

/** Same orientation rules as rowsToPlacement, for W/B/. rows. */
export function rowsToOccupancy(rows: string[], viewer: Side, rotated = false): OccupancyResult {
  if (rows.length !== 8) return { ok: false, error: `expected 8 rows, got ${rows.length}` };
  const clean: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = normalizeOccupancyRow(rows[i]);
    if (r === null) return { ok: false, error: `row ${i + 1} has unexpected characters` };
    if (r.length !== 8) return { ok: false, error: `row ${i + 1} has ${r.length} squares` };
    clean.push(r);
  }
  const nearIsWhite = (viewer === "w") !== rotated;
  const ranks = nearIsWhite
    ? clean
    : clean
        .slice()
        .reverse()
        .map((r) => r.split("").reverse().join(""));
  const occupancy = ranks.join("");
  const whites = occupancy.split("W").length - 1;
  const blacks = occupancy.split("B").length - 1;
  if (whites === 0 || blacks === 0 || whites > 16 || blacks > 16) {
    return { ok: false, error: `implausible piece count (${whites} light, ${blacks} dark)` };
  }
  return { ok: true, occupancy };
}

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export type OccupancyMatch =
  | { kind: "same"; distance: number }
  | { kind: "moved"; moves: Move[]; fen: string; lastMover: Side; distance: number; key: string }
  | { kind: "nomatch"; reason: string };

type Candidate = { occ: Occupancy; plies: number; moves: Move[]; fen: string; lastMover: Side | null };

/** Each extra ply costs half a square, so "no move" beats "a move plus a misread" on a tie. */
const PLY_PENALTY = 0.5;

/**
 * Find the game continuation (no move, one move by either side, or one move
 * each) whose resulting occupancy best matches what the camera saw.
 *
 * Accepts the best candidate only if it's within `maxErrors` misread squares
 * and clearly better (by a full square) than the next distinct candidate.
 * Promotions to different pieces look identical, so those assume a queen.
 */
export function matchOccupancy(prevFen: string, seen: Occupancy, maxErrors = 2): OccupancyMatch {
  const best = new Map<Occupancy, Candidate>();
  const offer = (c: Candidate) => {
    const prev = best.get(c.occ);
    const isQueenPromo = (m: Move[]) => m.every((x) => !x.promotion || x.promotion === "q");
    if (!prev || c.plies < prev.plies || (c.plies === prev.plies && !isQueenPromo(prev.moves) && isQueenPromo(c.moves))) {
      best.set(c.occ, c);
    }
  };

  offer({ occ: occupancyOf(placementOf(prevFen)), plies: 0, moves: [], fen: prevFen, lastMover: null });

  const toMove = turnOf(prevFen);
  const sides = [toMove, toMove === "w" ? "b" : "w"] as Side[];
  for (const side of sides) {
    const game = tryChess(withTurn(prevFen, side));
    if (!game) continue;
    for (const first of game.moves({ verbose: true })) {
      game.move(first);
      offer({ occ: occupancyOf(placementOf(game.fen())), plies: 1, moves: [first], fen: game.fen(), lastMover: side });
      game.undo();
    }
  }

  // Two-move sequences are ~30x more work. Skip them when "no move" or a
  // single move already matches exactly: the observed board can only equal
  // one occupancy, so every two-move sequence would be at least a square off
  // plus its ply penalty, which can never win or tie.
  if (!best.has(seen)) {
    for (const side of sides) {
      const game = tryChess(withTurn(prevFen, side));
      if (!game) continue;
      for (const first of game.moves({ verbose: true })) {
        game.move(first);
        for (const second of game.moves({ verbose: true })) {
          game.move(second);
          offer({
            occ: occupancyOf(placementOf(game.fen())),
            plies: 2,
            moves: [first, second],
            fen: game.fen(),
            lastMover: side === "w" ? "b" : "w",
          });
          game.undo();
        }
        game.undo();
      }
    }
  }

  const scored = [...best.values()]
    .map((c) => ({ c, distance: hamming(c.occ, seen), score: hamming(c.occ, seen) + c.plies * PLY_PENALTY }))
    .sort((a, b) => a.score - b.score);

  const top = scored[0];
  const runnerUp = scored[1];
  if (!top || top.distance > maxErrors) {
    return { kind: "nomatch", reason: `no legal continuation fits (closest is ${top?.distance ?? "?"} squares off)` };
  }
  if (runnerUp && runnerUp.score - top.score < 1) {
    return { kind: "nomatch", reason: "two different moves fit equally well" };
  }
  if (top.c.plies === 0) return { kind: "same", distance: top.distance };
  return {
    kind: "moved",
    moves: top.c.moves,
    fen: top.c.fen,
    lastMover: top.c.lastMover!,
    distance: top.distance,
    key: `${top.c.moves.map((m) => m.lan).join(" ")}|${placementOf(top.c.fen)}`,
  };
}
