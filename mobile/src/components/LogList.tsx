import { Pressable, StyleSheet, Text, View } from "react-native";

import type { LogLine } from "../hooks/useLog";
import { colors, mono, space } from "../theme";
import { Card, SectionTitle } from "./ui";

const LEVEL_COLOR = {
  info: colors.textDim,
  warn: colors.amber,
  error: colors.red,
} as const;

export function LogList({ lines, onClear }: { lines: LogLine[]; onClear: () => void }) {
  return (
    <Card>
      <SectionTitle
        right={
          lines.length ? (
            <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button">
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null
        }
      >
        Log
      </SectionTitle>
      {lines.length === 0 ? (
        <Text style={styles.empty}>Nothing yet.</Text>
      ) : (
        <View style={styles.list}>
          {lines.map((l) => (
            <View key={l.id} style={styles.line}>
              <Text style={styles.time}>{l.time}</Text>
              <Text style={[styles.text, { color: LEVEL_COLOR[l.level] }]}>
                {l.text}
                {l.count > 1 ? <Text style={styles.count}>{`  ×${l.count}`}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  clear: { color: colors.blue, fontSize: 13, fontWeight: "600" },
  empty: { color: colors.textMuted, fontSize: 13 },
  list: { gap: 6 },
  line: { flexDirection: "row", gap: space.sm },
  time: { color: colors.textMuted, fontFamily: mono, fontSize: 11, lineHeight: 17 },
  text: { flex: 1, fontSize: 13, lineHeight: 17 },
  count: { color: colors.textMuted, fontFamily: mono, fontSize: 11 },
});
