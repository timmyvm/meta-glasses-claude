import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  START_FEN,
  START_PLACEMENT,
  matchOccupancy,
  occupancyOf,
  placementOf,
  placementToRanks,
  rowsToOccupancy,
} from "../src/lib/board";
import { LOST_AFTER, LOST_NOTICE, NEW_GAME, readModeFor, trackStep, type Observation, type TrackerState } from "../src/lib/tracker";

function after(fen: string, ...sans: string[]) {
  const g = new Chess(fen);
  for (const s of sans) g.move(s);
  return g.fen();
}

/** Occupancy rows as White sees them (far = rank 8). */
function occRows(fen: string): string[] {
  const occ = occupancyOf(placementOf(fen));
  return Array.from({ length: 8 }, (_, i) => occ.slice(i * 8, i * 8 + 8));
}

function flip(occ: string, square: string): string {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const idx = (8 - rank) * 8 + file;
  const cur = occ[idx];
  const next = cur === "." ? "W" : ".";
  return occ.slice(0, idx) + next + occ.slice(idx + 1);
}

const fullRows = (fen: string): Observation => ({
  kind: "rows",
  mode: "full",
  rows: placementToRanks(placementOf(fen)),
  confidence: "high",
});
const occObs = (rows: string[]): Observation => ({ kind: "rows", mode: "occupancy", rows, confidence: "high" });

describe("rowsToOccupancy", () => {
  it("maps W/B/. rows and rotates for Black", () => {
    const rows = occRows(START_FEN);
    const r = rowsToOccupancy(rows, "w");
    expect(r.ok && r.occupancy).toBe(occupancyOf(START_PLACEMENT));
    const seenByBlack = rows.slice().reverse().map((x) => x.split("").reverse().join(""));
    const rb = rowsToOccupancy(seenByBlack, "b");
    expect(rb.ok && rb.occupancy).toBe(occupancyOf(START_PLACEMENT));
  });
  it("rejects piece letters and bad shapes", () => {
    expect(rowsToOccupancy(["rnbqkbnr", ...occRows(START_FEN).slice(1)], "w").ok).toBe(false);
    expect(rowsToOccupancy(occRows(START_FEN).slice(0, 7), "w").ok).toBe(false);
  });
});

describe("matchOccupancy", () => {
  it("finds a quiet move exactly", () => {
    const fen = after(START_FEN, "e4");
    const m = matchOccupancy(START_FEN, occupancyOf(placementOf(fen)));
    expect(m.kind).toBe("moved");
    if (m.kind === "moved") expect(m.moves.map((x) => x.san)).toEqual(["e4"]);
  });

  it("finds a capture from colors alone", () => {
    const prev = after(START_FEN, "e4", "d5");
    const m = matchOccupancy(prev, occupancyOf(placementOf(after(prev, "exd5"))));
    expect(m.kind === "moved" && m.moves[0].san).toBe("exd5");
  });

  it("finds castling and en passant", () => {
    const pre = after(START_FEN, "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5");
    const castle = matchOccupancy(pre, occupancyOf(placementOf(after(pre, "O-O"))));
    expect(castle.kind === "moved" && castle.moves[0].san).toBe("O-O");

    const ep = after(START_FEN, "e4", "a6", "e5", "d5");
    const epm = matchOccupancy(ep, occupancyOf(placementOf(after(ep, "exd6"))));
    expect(epm.kind === "moved" && epm.moves[0].san).toBe("exd6");
  });

  it("assumes a queen when a pawn promotes", () => {
    const prev = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
    const m = matchOccupancy(prev, occupancyOf(placementOf(after(prev, "e8=Q"))));
    expect(m.kind === "moved" && m.moves[0].promotion).toBe("q");
  });

  it("tolerates one misread square away from the move", () => {
    const fen = after(START_FEN, "d4");
    const noisy = flip(occupancyOf(placementOf(fen)), "h6");
    const m = matchOccupancy(START_FEN, noisy);
    expect(m.kind === "moved" && m.moves[0].san).toBe("d4");
  });

  it("reports no move for the same board, even with a stray square", () => {
    expect(matchOccupancy(START_FEN, occupancyOf(START_PLACEMENT)).kind).toBe("same");
    expect(matchOccupancy(START_FEN, flip(occupancyOf(START_PLACEMENT), "a5")).kind).toBe("same");
  });

  it("refuses garbage", () => {
    const garbage = "W.B.W.B.".repeat(8);
    expect(matchOccupancy(START_FEN, garbage).kind).toBe("nomatch");
  });

  it("finds two moves when a read was missed", () => {
    const m = matchOccupancy(START_FEN, occupancyOf(placementOf(after(START_FEN, "e4", "c5"))));
    expect(m.kind === "moved" && m.moves.map((x) => x.san)).toEqual(["e4", "c5"]);
  });

  it("runs fast enough for every photo", () => {
    const prev = after(START_FEN, "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7");
    const exact = occupancyOf(placementOf(after(prev, "Re1")));
    let t = performance.now();
    matchOccupancy(prev, exact);
    const fast = performance.now() - t;
    t = performance.now();
    matchOccupancy(prev, flip(exact, "a5")); // a misread forces the two-move search
    const slow = performance.now() - t;
    console.log(`occupancy match: exact ${fast.toFixed(0)}ms, with a misread ${slow.toFixed(0)}ms`);
    expect(fast).toBeLessThan(100);
    expect(slow).toBeLessThan(2000);
  });
});

describe("trackStep", () => {
  const W = { viewer: "w" as const, rotated: false, trigger: "auto" as const };

  it("starts with a full read, then tracks with occupancy reads", () => {
    expect(readModeFor(NEW_GAME)).toBe("full");
    const r = trackStep(NEW_GAME, fullRows(START_FEN), W);
    expect(r.analyze).toBe(START_FEN);
    expect(readModeFor(r.state)).toBe("occupancy");
  });

  it("needs two agreeing reads before accepting a move", () => {
    const s: TrackerState = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    const e4 = after(START_FEN, "e4");
    const first = trackStep(s, occObs(occRows(e4)), W);
    expect(first.state.pending).not.toBeNull();
    expect(first.recheck).toBe(true);
    expect(first.state.fen).toBe(START_FEN);

    const second = trackStep(first.state, occObs(occRows(e4)), W);
    expect(second.state.fen).toBe(e4);
    expect(second.myTurn).toBe(false);
    expect(second.log.at(-1)?.text).toBe("You played e4");

    const e5 = after(e4, "e5");
    const third = trackStep(trackStep(second.state, occObs(occRows(e5)), W).state, occObs(occRows(e5)), W);
    expect(third.analyze).toBe(e5);
    expect(third.log.at(-1)?.text).toBe("Opponent played e5");
  });

  it("accepts a move on one read when asked manually", () => {
    const s = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    const r = trackStep(s, occObs(occRows(after(START_FEN, "e4"))), { ...W, trigger: "manual" });
    expect(r.state.fen).toBe(after(START_FEN, "e4"));
  });

  it("drops a pending move when the next read disagrees", () => {
    const s = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    const first = trackStep(s, occObs(occRows(after(START_FEN, "e4"))), W);
    const back = trackStep(first.state, occObs(occRows(START_FEN)), W);
    expect(back.state.pending).toBeNull();
    expect(back.state.fen).toBe(START_FEN);
  });

  it(`says it lost track after ${LOST_AFTER} unmatched reads, then resyncs with a full read`, () => {
    let s = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    const garbage = Array(8).fill("W.B.W.B.");
    let notice: string | null = null;
    for (let i = 0; i < LOST_AFTER; i++) {
      const r = trackStep(s, occObs(garbage), W);
      s = r.state;
      notice = r.notice ?? notice;
    }
    expect(notice).toBe(LOST_NOTICE);
    expect(readModeFor(s)).toBe("full");
    const resync = trackStep(s, fullRows(after(START_FEN, "e4", "e5")), W);
    expect(resync.state.lost).toBe(false);
    expect(resync.analyze).toBe(after(START_FEN, "e4", "e5"));
  });

  it("stays quiet on unreadable frames unless asked", () => {
    const s = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    expect(trackStep(s, { kind: "unreadable", notes: "hand" }, W).log).toHaveLength(0);
    expect(trackStep(s, { kind: "unreadable", notes: "hand" }, { ...W, trigger: "manual" }).log).toHaveLength(1);
  });

  it("manual ask with no change repeats on my turn, forces my turn otherwise", () => {
    const s = trackStep(NEW_GAME, fullRows(START_FEN), W).state;
    expect(trackStep(s, occObs(occRows(START_FEN)), { ...W, trigger: "manual" }).repeat).toBe(true);
    const seenByBlack = (rows: string[]) => rows.slice().reverse().map((x) => x.split("").reverse().join(""));
    const startForBlack: Observation = { kind: "rows", mode: "full", rows: seenByBlack(placementToRanks(START_PLACEMENT)), confidence: "high" };
    const sb = trackStep(NEW_GAME, startForBlack, { ...W, viewer: "b" }).state;
    expect(sb.fen).toBe(START_FEN);
    const blackRows = seenByBlack(occRows(START_FEN));
    const forced = trackStep(sb, occObs(blackRows), { viewer: "b", rotated: false, trigger: "manual" });
    expect(forced.myTurn).toBe(true);
    expect(forced.analyze?.split(" ")[1]).toBe("b");
  });
});
