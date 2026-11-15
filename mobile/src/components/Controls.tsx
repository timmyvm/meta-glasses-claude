import { Alert, StyleSheet, Text, View } from "react-native";

import { errorText } from "../api";
import type { Glasses } from "../hooks/useGlasses";
import { colors, space } from "../theme";
import { Button } from "./ui";

type Props = {
  glasses: Glasses;
  watching: boolean;
  hasGame: boolean;
  hasLastSay: boolean;
  onStart: () => void;
  onStop: () => void;
  onAskNow: () => void;
  onNewGame: () => void;
  onSayAgain: () => void;
  onTestVoice: () => void;
  log: (level: "info" | "warn" | "error", text: string) => void;
};

function connectLabel(g: Glasses): { title: string; done: boolean } {
  if (g.registration !== "registered") return { title: "Connect glasses", done: false };
  if (g.permission !== "granted") return { title: "Allow glasses camera", done: false };
  return { title: g.connected ? "Glasses ready ✓" : "Glasses registered ✓", done: true };
}

export function Controls(p: Props) {
  const g = p.glasses;
  const connect = connectLabel(g);

  const run = (fn: () => Promise<void>) => {
    fn().catch((err: unknown) => p.log("error", errorText(err)));
  };

  const confirmNewGame = () => {
    if (!p.hasGame) {
      p.onNewGame();
      return;
    }
    Alert.alert("New game?", "Forget the tracked position and start over.", [
      { text: "Cancel", style: "cancel" },
      { text: "New game", style: "destructive", onPress: p.onNewGame },
    ]);
  };

  return (
    <View style={styles.wrap}>
      {!connect.done || !g.isConfigured ? (
        <Button
          title={connect.title}
          variant="secondary"
          onPress={() => run(g.connect)}
          loading={g.busy}
          disabled={!g.isConfigured}
        />
      ) : null}

      {p.watching ? (
        <Button big title="Stop watching" variant="danger" onPress={p.onStop} />
      ) : (
        <Button big title="Start watching" variant="primary" onPress={p.onStart} disabled={g.busy} />
      )}

      <View style={styles.row}>
        <Button style={styles.flex} title="Ask now" onPress={p.onAskNow} disabled={!p.watching} />
        <Button style={styles.flex} title="Say again" onPress={p.onSayAgain} disabled={!p.hasLastSay} />
      </View>
      <View style={styles.row}>
        <Button style={styles.flex} title="New game" onPress={confirmNewGame} />
        <Button style={styles.flex} title="Test voice" onPress={p.onTestVoice} />
      </View>

      {connect.done && g.isConfigured ? (
        <Button title={connect.title} variant="ghost" onPress={() => run(g.connect)} loading={g.busy} />
      ) : null}

      {__DEV__ ? (
        <View style={styles.devBox}>
          <Text style={styles.devTitle}>Developer build</Text>
          <Text style={styles.devText}>
            Test the whole loop without glasses: a simulated pair of glasses uses the phone's back camera. Point the
            phone at a board, then Start watching.
          </Text>
          <Button
            title={g.testMode ? "Stop testing with phone camera" : "Test with phone camera"}
            variant="ghost"
            loading={g.busy}
            disabled={p.watching}
            onPress={() => run(g.testMode ? g.disableTestMode : g.enableTestMode)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
  devBox: {
    marginTop: space.sm,
    padding: space.md,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    gap: space.sm,
  },
  devTitle: { color: colors.blue, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  devText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
});
