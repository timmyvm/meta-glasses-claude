/** Tiny helpers for showing the tracked board. No chess rules here: the server owns those. */

export type Piece = "p" | "n" | "b" | "r" | "q" | "k" | "P" | "N" | "B" | "R" | "Q" | "K";

export type Square = {
  /** e.g. "e4" */
  name: string;
  piece: Piece | null;
  dark: boolean;
};

const FILES = "abcdefgh";

/**
 * U+FE0E forces text (not emoji) presentation; without it iOS draws ♟ as a
 * colored emoji. White pieces use outline glyphs, black pieces solid ones.
 */
const GLYPHS: Record<Piece, string> = {
  K: "♔︎",
  Q: "♕︎",
  R: "♖︎",
  B: "♗︎",
  N: "♘︎",
  P: "♙︎",
  k: "♚︎",
  q: "♛︎",
  r: "♜︎",
  b: "♝︎",
  n: "♞︎",
  p: "♟︎",
};

export function glyph(p: Piece): string {
  return GLYPHS[p];
}

/**
 * Parse a FEN piece placement ("rnbqkbnr/pppppppp/8/...") into 8 rows of 8
 * squares, oriented for the viewer: White sees rank 8 at the top and the
 * a-file on the left; Black sees rank 1 at the top and the h-file on the left.
 * Returns null if the placement is malformed.
 */
export function boardRows(placement: string, viewer: "w" | "b"): Square[][] | null {
  const ranks = placement.trim().split(" ")[0].split("/");
  if (ranks.length !== 8) return null;

  // rows[0] = rank 8 ... rows[7] = rank 1, files a..h
  const rows: Square[][] = [];
  for (let r = 0; r < 8; r++) {
    const rankNum = 8 - r;
    const row: Square[] = [];
    for (const ch of ranks[r]) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(makeSquare(row.length, rankNum, null));
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        row.push(makeSquare(row.length, rankNum, ch as Piece));
      } else {
        return null;
      }
      if (row.length > 8) return null;
    }
    if (row.length !== 8) return null;
    rows.push(row);
  }

  if (viewer === "b") return rows.reverse().map((row) => row.reverse());
  return rows;
}

function makeSquare(fileIdx: number, rank: number, piece: Piece | null): Square {
  return {
    name: `${FILES[fileIdx]}${rank}`,
    piece,
    // a1 is dark: file index 0 + rank 1 -> odd sum -> dark
    dark: (fileIdx + rank) % 2 === 1,
  };
}

/** Files/ranks labels in display order for the viewer. */
export function fileLabels(viewer: "w" | "b"): string[] {
  const f = FILES.split("");
  return viewer === "w" ? f : f.reverse();
}

export function rankLabels(viewer: "w" | "b"): string[] {
  const r = ["8", "7", "6", "5", "4", "3", "2", "1"];
  return viewer === "w" ? r : r.reverse();
}

/** "g1f3" -> ["g1", "f3"]; promotions ("e7e8q") keep just the squares. */
export function uciSquares(uci: string | null | undefined): [string, string] | null {
  if (!uci || uci.length < 4) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}
