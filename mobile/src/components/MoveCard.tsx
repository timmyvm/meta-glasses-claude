import { StyleSheet, Text, View } from "react-native";

import type { Phase, Reading, Timing } from "../hooks/useWatcher";
import { colors, mono, radius, space } from "../theme";
import { Card } from "./ui";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "Not watching",
  starting: "Starting the glasses camera…",
  waitingForVideo: "Waiting for video from the glasses…",
  capturing: "Taking a photo…",
  thinking: "Reading the board…",
  waiting: "Watching",
};

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MoveCard({
  reading,
  timing,
  phase,
  watching,
  intervalSec,
}: {
  reading: Reading;
  timing: Timing | null;
  phase: Phase;
  watching: boolean;
  intervalSec: number;
}) {
  const { suggestion, myTurn } = reading;
  const stale = suggestion !== null && myTurn === false;

  const turn =
    myTurn === true
      ? { text: "Your move", color: colors.accent }
      : myTurn === false
        ? { text: "Opponent to move", color: colors.amber }
        : { text: "Waiting for a clear look at the board", color: colors.textMuted };

  const busy = phase === "capturing" || phase === "thinking" || phase === "starting";
  const phaseText = phase === "waiting" && watching ? `Watching · photo every ${intervalSec}s` : PHASE_TEXT[phase];

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.turnBadge, { borderColor: `${turn.color}55`, backgroundColor: `${turn.color}14` }]}>
          <Text style={[styles.turnText, { color: turn.color }]}>{turn.text}</Text>
        </View>
        {suggestion?.score ? (
          <View style={styles.scoreChip}>
            <Text style={styles.scoreText}>{suggestion.score}</Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[styles.san, stale && styles.stale, !suggestion && styles.placeholder]}
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityLabel={suggestion ? `Suggested move ${suggestion.spoken}` : "No move yet"}
      >
        {suggestion ? suggestion.san : "—"}
      </Text>
      <Text style={styles.spoken} numberOfLines={1}>
        {suggestion ? (stale ? `Last suggestion: ${suggestion.spoken}` : suggestion.spoken) : "No move yet"}
      </Text>

      <View style={styles.divider} />

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: busy ? colors.blue : watching ? colors.accent : colors.textMuted }]} />
        <Text style={styles.statusText}>{phaseText}</Text>
      </View>
      {timing ? (
        <Text style={styles.timing}>
          {timing.skipped ? "unchanged · " : ""}photo {secs(timing.captureMs)} · round trip {secs(timing.roundTripMs)} (server{" "}
          {secs(timing.serverMs)}){"\n"}
          {timing.photo}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: space.lg },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  turnBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 1,
  },
  turnText: { fontSize: 14, fontWeight: "700" },
  scoreChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.cardRaised,
    marginLeft: space.sm,
  },
  scoreText: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: "600" },
  san: {
    color: colors.text,
    fontSize: 88,
    lineHeight: 100,
    fontWeight: "800",
    letterSpacing: -2,
    marginTop: space.md,
  },
  stale: { opacity: 0.35 },
  placeholder: { color: colors.textMuted },
  spoken: { color: colors.textDim, fontSize: 18, fontWeight: "500", marginTop: -4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.md,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textDim, fontSize: 14, fontWeight: "500" },
  timing: { color: colors.textMuted, fontFamily: mono, fontSize: 11, marginTop: 6, lineHeight: 16 },
});
