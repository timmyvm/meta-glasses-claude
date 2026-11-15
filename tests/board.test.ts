import { describe, expect, it } from "vitest";
import {
  START_FEN,
  START_PLACEMENT,
  buildFen,
  decide,
  inferCastling,
  inferMove,
  normalizeRow,
  placementOf,
  placementToRanks,
  rowsToPlacement,
  turnOf,
  uciToSan,
} from "../src/lib/board";
import { Chess } from "chess.js";

const startRanks = placementToRanks(START_PLACEMENT);

function after(fen: string, ...sans: string[]) {
  const g = new Chess(fen);
  for (const s of sans) g.move(s);
  return g.fen();
}

describe("normalizeRow", () => {
  it("expands FEN digits and odd empty markers", () => {
    expect(normalizeRow("r3k2r")).toBe("r...k..r");
    expect(normalizeRow("p-p_p0 . ")).toBe("p.p.p..");
    expect(normalizeRow(" P P P P ")).toBe("PPPP");
  });
});

describe("rowsToPlacement", () => {
  it("maps rows as seen by White directly", () => {
    const r = rowsToPlacement(startRanks, "w");
    expect(r.ok && r.placement).toBe(START_PLACEMENT);
  });

  it("rotates 180 degrees for a Black viewer", () => {
    // What Black sees from their seat: White's pieces far away, mirrored.
    const seenByBlack = startRanks.slice().reverse().map((r) => r.split("").reverse().join(""));
    const r = rowsToPlacement(seenByBlack, "b");
    expect(r.ok && r.placement).toBe(START_PLACEMENT);
  });

  it("honours the rotated override", () => {
    const seenByBlack = startRanks.slice().reverse().map((r) => r.split("").reverse().join(""));
    const r = rowsToPlacement(seenByBlack, "w", true);
    expect(r.ok && r.placement).toBe(START_PLACEMENT);
  });

  it("rejects boards without exactly one king each", () => {
    const rows = [...startRanks];
    rows[0] = "rnbq.bnr";
    const r = rowsToPlacement(rows, "w");
    expect(r.ok).toBe(false);
  });

  it("rejects wrong row counts and lengths", () => {
    expect(rowsToPlacement(startRanks.slice(0, 7), "w").ok).toBe(false);
    const rows = [...startRanks];
    rows[3] = ".......";
    expect(rowsToPlacement(rows, "w").ok).toBe(false);
  });

  it("rejects pawns on the back rank", () => {
    const rows = [...startRanks];
    rows[0] = "rnbqkbnP";
    expect(rowsToPlacement(rows, "w").ok).toBe(false);
  });
});

describe("inferCastling", () => {
  it("gives full rights in the start position", () => {
    expect(inferCastling(START_PLACEMENT)).toBe("KQkq");
  });
  it("drops rights once a king has moved", () => {
    expect(inferCastling("rnbq1bnr/ppppkppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR")).toBe("KQ");
  });
});

describe("inferMove", () => {
  it("finds a single opponent move", () => {
    const prev = after(START_FEN, "e4");
    const next = placementOf(after(prev, "e5"));
    const inf = inferMove(prev, next);
    expect(inf.kind).toBe("moved");
    if (inf.kind === "moved") {
      expect(inf.moves.map((m) => m.san)).toEqual(["e5"]);
      expect(turnOf(inf.fen)).toBe("w");
    }
  });

  it("finds a move by the side that was NOT expected to move", () => {
    // We think it's White's move, but actually White moved e4 earlier and the
    // fen we stored still says white; now a black move appears.
    const prev = withWrongTurn(after(START_FEN, "e4"));
    const next = placementOf(after(after(START_FEN, "e4"), "c5"));
    const inf = inferMove(prev, next);
    expect(inf.kind).toBe("moved");
    if (inf.kind === "moved") expect(inf.lastMover).toBe("b");
  });

  it("finds two moves when a frame was missed", () => {
    const prev = START_FEN;
    const next = placementOf(after(START_FEN, "d4", "Nf6"));
    const inf = inferMove(prev, next);
    expect(inf.kind).toBe("moved");
    if (inf.kind === "moved") {
      expect(inf.moves.map((m) => m.san)).toEqual(["d4", "Nf6"]);
      expect(turnOf(inf.fen)).toBe("w");
    }
  });

  it("tracks castling and keeps correct rights afterwards", () => {
    const prev = after(START_FEN, "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5");
    const castled = after(prev, "O-O");
    const inf = inferMove(prev, placementOf(castled));
    expect(inf.kind).toBe("moved");
    if (inf.kind === "moved") {
      expect(inf.moves[0].san).toBe("O-O");
      expect(inf.fen.split(" ")[2]).toBe("kq");
    }
  });

  it("tracks en passant so the engine can use it", () => {
    const prev = after(START_FEN, "e4", "a6", "e5");
    const next = placementOf(after(prev, "d5"));
    const inf = inferMove(prev, next);
    expect(inf.kind).toBe("moved");
    if (inf.kind === "moved") {
      expect(inf.fen.split(" ")[3]).toBe("d6");
      expect(uciToSan(inf.fen, "e5d6")).toBe("exd6");
    }
  });

  it("returns same / unknown", () => {
    expect(inferMove(START_FEN, START_PLACEMENT).kind).toBe("same");
    expect(inferMove(START_FEN, "4k3/8/8/8/8/8/8/4K3").kind).toBe("unknown");
  });
});

function withWrongTurn(fen: string) {
  const p = fen.split(" ");
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";
  return p.join(" ");
}

describe("decide", () => {
  it("start position: White to move, Black waits", () => {
    expect(decide(null, START_PLACEMENT, "w", false)).toMatchObject({ how: "start", myTurn: true });
    expect(decide(null, START_PLACEMENT, "b", false)).toMatchObject({ how: "start", myTurn: false });
  });

  it("mid-game pickup assumes it's my move", () => {
    const placement = placementOf(after(START_FEN, "e4", "e5", "Nf3"));
    const d = decide(null, placement, "b", false);
    expect(d).toMatchObject({ how: "fresh", myTurn: true });
    expect(turnOf(d.fen)).toBe("b");
  });

  it("goes quiet after I move and speaks after the opponent moves", () => {
    const start = decide(null, START_PLACEMENT, "w", false);
    const mine = decide(start.fen, placementOf(after(start.fen, "e4")), "w", false);
    expect(mine).toMatchObject({ how: "moved", myTurn: false });
    expect(mine.note).toBe("You played e4");
    const theirs = decide(mine.fen, placementOf(after(mine.fen, "c5")), "w", false);
    expect(theirs).toMatchObject({ how: "moved", myTurn: true });
    expect(theirs.note).toBe("Opponent played c5");
  });

  it("force makes it my move even when the tracker disagrees", () => {
    const d = decide(after(START_FEN, "e4"), placementOf(after(START_FEN, "e4")), "w", true);
    expect(d.myTurn).toBe(true);
    expect(turnOf(d.fen)).toBe("w");
  });

  it("lost track keeps only castling rights that are still possible", () => {
    const prev = after(START_FEN, "e4", "e5", "Ke2"); // White lost castling
    const d = decide(prev, "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPPKPPP/RNBQ1B1R", "w", false);
    expect(d.how).toBe("unknown");
    expect(d.fen.split(" ")[2]).toBe("kq");
  });
});

describe("buildFen", () => {
  it("produces a legal FEN", () => {
    expect(() => new Chess(buildFen(START_PLACEMENT, "b"))).not.toThrow();
  });
});

describe("decide with force after my own move", () => {
  it("does not suggest a second move for me", () => {
    const d = decide(START_FEN, placementOf(after(START_FEN, "e4")), "w", true);
    expect(d).toMatchObject({ how: "moved", myTurn: false });
  });
});
