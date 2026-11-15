import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { boardRows, glyph, uciSquares } from "../chess";
import { colors, radius } from "../theme";

/**
 * The board as the server is tracking it, drawn from the viewer's side.
 * When it's the viewer's move, the suggested move's from/to squares are highlighted.
 */
export const BoardGrid = memo(function BoardGrid({
  placement,
  viewer,
  highlightUci,
  size,
}: {
  placement: string | null;
  viewer: "w" | "b";
  highlightUci: string | null;
  size: number;
}) {
  const rows = placement ? boardRows(placement, viewer) : null;
  const sq = Math.floor(size / 8);
  const boardSize = sq * 8;

  if (!rows) {
    return (
      <View style={[styles.empty, { width: size, height: size }]}>
        <Text style={styles.emptyText}>
          {placement ? "Couldn't draw this position" : "The tracked board shows up after the first good read"}
        </Text>
      </View>
    );
  }

  const hl = uciSquares(highlightUci);
  const pieceSize = Math.round(sq * 0.82);
  const coordSize = Math.max(7, Math.round(sq * 0.28));

  return (
    <View style={[styles.board, { width: boardSize, height: boardSize }]}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((s, c) => {
            const isFrom = hl?.[0] === s.name;
            const isTo = hl?.[1] === s.name;
            const base = s.dark ? colors.boardDark : colors.boardLight;
            const coordColor = s.dark ? colors.boardLight : colors.boardDark;
            return (
              <View key={s.name} style={{ width: sq, height: sq, backgroundColor: base }}>
                {isFrom || isTo ? (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: isTo ? colors.highlightTo : colors.highlightFrom },
                    ]}
                  />
                ) : null}
                {c === 0 ? (
                  <Text style={[styles.rank, { color: coordColor, fontSize: coordSize }]}>{s.name[1]}</Text>
                ) : null}
                {r === 7 ? (
                  <Text style={[styles.file, { color: coordColor, fontSize: coordSize }]}>{s.name[0]}</Text>
                ) : null}
                {s.piece ? (
                  <Text
                    allowFontScaling={false}
                    style={[styles.piece, { fontSize: pieceSize, lineHeight: sq, width: sq, height: sq }]}
                  >
                    {glyph(s.piece)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  board: { borderRadius: radius.sm, overflow: "hidden" },
  row: { flexDirection: "row" },
  piece: {
    position: "absolute",
    left: 0,
    top: 0,
    textAlign: "center",
    color: colors.boardInk,
  },
  rank: { position: "absolute", left: 2, top: 0, fontWeight: "700" },
  file: { position: "absolute", right: 2, bottom: 0, fontWeight: "700" },
  empty: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  emptyText: { color: colors.textMuted, fontSize: 12, textAlign: "center", lineHeight: 17 },
});
