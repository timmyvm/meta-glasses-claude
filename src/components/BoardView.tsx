import { placementToRanks, type Side } from "@/lib/board";

const GLYPH: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const FILES = "abcdefgh";

type Props = {
  placement: string | null;
  orientation: Side;
  /** UCI move to highlight, e.g. "g1f3" */
  highlight?: string | null;
  lastMove?: { from: string; to: string } | null;
};

export function BoardView({ placement, orientation, highlight, lastMove }: Props) {
  const ranks = placementToRanks(placement ?? "8/8/8/8/8/8/8/8");
  const from = highlight?.slice(0, 2);
  const to = highlight?.slice(2, 4);

  const rows = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl ring-1 ring-white/10">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {rows.map((r) =>
          cols.map((c) => {
            const sq = `${FILES[c]}${8 - r}`;
            const piece = ranks[r]?.[c] ?? ".";
            const light = (r + c) % 2 === 0;
            const isBest = sq === from || sq === to;
            const isLast = lastMove && (sq === lastMove.from || sq === lastMove.to);
            const white = piece !== "." && piece === piece.toUpperCase();
            return (
              <div
                key={sq}
                className={[
                  "relative flex items-center justify-center",
                  light ? "bg-[#d9dde4]" : "bg-[#6b7a90]",
                ].join(" ")}
              >
                {isLast && <div className="absolute inset-0 bg-amber-300/35" />}
                {isBest && (
                  <div
                    className={[
                      "absolute inset-0",
                      sq === to ? "bg-emerald-400/60" : "bg-emerald-400/30",
                    ].join(" ")}
                  />
                )}
                {piece !== "." && (
                  <span
                    className={[
                      "relative select-none leading-none text-[min(8vw,2.6rem)] lg:text-[2.6rem]",
                      white
                        ? "text-white [text-shadow:0_0_1px_#000,0_0_1px_#000,0_1px_2px_rgba(0,0,0,.6)]"
                        : "text-zinc-950 [text-shadow:0_0_1px_rgba(255,255,255,.35)]",
                    ].join(" ")}
                    style={{ fontVariantEmoji: "text" } as React.CSSProperties}
                  >
                    {GLYPH[piece.toLowerCase()]}
                    {"︎"}
                  </span>
                )}
                {c === cols[0] && (
                  <span
                    className={`absolute left-0.5 top-0.5 text-[10px] font-semibold ${light ? "text-[#6b7a90]" : "text-[#d9dde4]"}`}
                  >
                    {8 - r}
                  </span>
                )}
                {r === rows[7] && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[10px] font-semibold ${light ? "text-[#6b7a90]" : "text-[#d9dde4]"}`}
                  >
                    {FILES[c]}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
      {!placement && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 text-sm text-zinc-300">
          No board read yet
        </div>
      )}
    </div>
  );
}
