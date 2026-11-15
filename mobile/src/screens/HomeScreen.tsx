import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BoardGrid } from "../components/BoardGrid";
import { Controls } from "../components/Controls";
import { Header } from "../components/Header";
import { LivePreview } from "../components/LivePreview";
import { LogList } from "../components/LogList";
import { MoveCard } from "../components/MoveCard";
import { SettingsPanel } from "../components/SettingsPanel";
import { useGlasses } from "../hooks/useGlasses";
import { useLog } from "../hooks/useLog";
import { useSettings } from "../hooks/useSettings";
import { useWatcher } from "../hooks/useWatcher";
import { colors, space } from "../theme";

const GUTTER = space.lg;
const GAP = space.md;

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const log = useLog();
  const { settings, loaded, update } = useSettings();
  const glasses = useGlasses(log.add);
  const watcher = useWatcher({ glasses, settings, log: log.add });

  // Preview and board sit side by side, each half the content width.
  const tile = Math.floor((Math.min(width, 520) - GUTTER * 2 - GAP) / 2);
  const { reading } = watcher;

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Header glasses={glasses} />

        <MoveCard
          reading={reading}
          timing={watcher.timing}
          phase={watcher.phase}
          watching={watcher.watching}
          intervalSec={settings.intervalSec}
        />

        <View style={styles.tiles}>
          <LivePreview active={glasses.isStreaming} size={tile} testMode={glasses.testMode} />
          <BoardGrid
            placement={reading.placement}
            viewer={settings.viewer}
            highlightUci={reading.myTurn ? (reading.suggestion?.uci ?? null) : null}
            size={tile}
          />
        </View>

        <Controls
          glasses={glasses}
          watching={watcher.watching}
          hasGame={watcher.hasGame}
          hasLastSay={watcher.lastSay !== null}
          onStart={watcher.start}
          onStop={watcher.stop}
          onAskNow={watcher.askNow}
          onNewGame={watcher.newGame}
          onSayAgain={watcher.sayAgain}
          onTestVoice={watcher.testVoice}
          log={log.add}
        />

        <SettingsPanel
          settings={settings}
          update={update}
          watching={watcher.watching}
          initiallyOpen={!settings.serverUrl}
        />

        <LogList lines={log.lines} onClear={log.clear} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: GUTTER,
    paddingTop: space.sm,
    paddingBottom: space.xl * 2,
    gap: space.lg,
  },
  tiles: { flexDirection: "row", gap: GAP, alignItems: "flex-start" },
});
