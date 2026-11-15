/** Shared UCI output parsing for Stockfish in the browser and on the server. */

export type Analysis = {
  bestmove: string | null; // UCI, e.g. "g1f3"; null when there are no legal moves
  depth: number;
  scoreCp?: number; // centipawns from the side-to-move's point of view
  mate?: number; // moves to mate (negative = side to move gets mated)
  pv: string[];
};

export function emptyAnalysis(): Analysis {
  return { bestmove: null, depth: 0, pv: [] };
}

/** Fold one `info ...` line into the running result (main line only). */
export function applyInfoLine(result: Analysis, line: string): void {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return;
  if (/ multipv (?!1 )\d+/.test(line)) return;
  if (/ (lowerbound|upperbound)/.test(line)) return;
  const depth = Number(line.match(/ depth (\d+)/)?.[1] ?? 0);
  if (depth < result.depth) return;
  result.depth = depth;
  const cp = line.match(/ score cp (-?\d+)/);
  const mate = line.match(/ score mate (-?\d+)/);
  result.scoreCp = cp ? Number(cp[1]) : undefined;
  result.mate = mate ? Number(mate[1]) : undefined;
  result.pv = line.split(" pv ")[1].trim().split(/\s+/);
}

/** Read the move out of a `bestmove ...` line. */
export function parseBestmove(line: string): string | null {
  const best = line.split(/\s+/)[1];
  return best && best !== "(none)" ? best : null;
}
