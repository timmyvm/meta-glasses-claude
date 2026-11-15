import { EMWDATStreamView } from "expo-meta-wearables-dat";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "../theme";

/** Small view of the glasses camera so the wearer can check the board is in frame. */
export function LivePreview({ active, size, testMode }: { active: boolean; size: number; testMode: boolean }) {
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <EMWDATStreamView isActive={active} resizeMode="contain" style={StyleSheet.absoluteFill} />
      {!active ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayIcon}>◉</Text>
          <Text style={styles.overlayText}>Camera off</Text>
        </View>
      ) : null}
      <View style={styles.label} pointerEvents="none">
        <Text style={styles.labelText}>{testMode ? "PHONE CAM" : "GLASSES"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  overlayIcon: { color: colors.textMuted, fontSize: 22 },
  overlayText: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  label: {
    position: "absolute",
    left: 6,
    top: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  labelText: { color: colors.textDim, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
});
