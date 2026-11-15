import { StyleSheet, Text, View } from "react-native";

import type { Glasses } from "../hooks/useGlasses";
import { colors, space } from "../theme";
import { Pill, type Tone } from "./ui";

export function glassesStatus(g: Glasses): { label: string; tone: Tone } {
  if (!g.isConfigured) return g.configError ? { label: "SDK error", tone: "bad" } : { label: "Starting…", tone: "muted" };
  const prefix = g.testMode ? "Test · " : "";
  switch (g.registration) {
    case "registered":
      if (g.permission !== "granted") return { label: `${prefix}No camera access`, tone: "warn" };
      return g.connected
        ? { label: `${prefix}Connected`, tone: "good" }
        : { label: `${prefix}Registered`, tone: "warn" };
    case "registering":
      return { label: "Registering…", tone: "warn" };
    default:
      return { label: "Not registered", tone: "bad" };
  }
}

function streamStatus(g: Glasses): { label: string; tone: Tone } {
  if (!g.sessionId) return { label: "Camera off", tone: "muted" };
  switch (g.streamState) {
    case "streaming":
      return { label: "Live", tone: "good" };
    case "paused":
      return { label: "Paused", tone: "warn" };
    default:
      // A session exists but no video yet ("stopped" is the hook's initial value).
      return { label: "Starting…", tone: "warn" };
  }
}

export function Header({ glasses }: { glasses: Glasses }) {
  const gs = glassesStatus(glasses);
  const ss = streamStatus(glasses);
  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.title}>IRL Engine</Text>
        <Text style={styles.subtitle}>over-the-board coach</Text>
      </View>
      <View style={styles.pills}>
        <Pill label={gs.label} tone={gs.tone} />
        <Pill label={ss.label} tone={ss.tone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  pills: { alignItems: "flex-end", gap: 6 },
});
