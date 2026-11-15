import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radius, space } from "../theme";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "danger" | "secondary" | "ghost";

export function Button({
  title,
  onPress,
  variant = "secondary",
  disabled,
  loading,
  big,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = VARIANTS[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: v.text }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; border: string; text: string }> = {
  primary: { bg: colors.accent, border: colors.accent, text: "#062014" },
  danger: { bg: "#2A1618", border: "#5A2A2E", text: colors.red },
  secondary: { bg: colors.cardRaised, border: colors.border, text: colors.text },
  ghost: { bg: "transparent", border: colors.border, text: colors.textDim },
};

// ---------------------------------------------------------------------------
// Pill (status badge with a dot)
// ---------------------------------------------------------------------------

export type Tone = "good" | "warn" | "bad" | "muted" | "info";

export const TONE_COLORS: Record<Tone, string> = {
  good: colors.accent,
  warn: colors.amber,
  bad: colors.red,
  muted: colors.textMuted,
  info: colors.blue,
};

export function Pill({ label, tone }: { label: string; tone: Tone }) {
  const c = TONE_COLORS[tone];
  return (
    <View style={[styles.pill, { borderColor: `${c}55`, backgroundColor: `${c}14` }]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.pillText, { color: c }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

export function Stepper({
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel="Decrease"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepBtn, value <= min && styles.disabled]}
      >
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format(value)}</Text>
      <Pressable
        accessibilityLabel="Increase"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepBtn, value >= max && styles.disabled]}
      >
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  button: {
    minHeight: 46,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBig: { minHeight: 58, borderRadius: radius.lg },
  buttonText: { fontSize: 15, fontWeight: "600" },
  buttonTextBig: { fontSize: 18, fontWeight: "700" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.4 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "600" },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.cardRaised },
  segmentText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  segmentTextActive: { color: colors.text },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stepBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  stepBtnText: { color: colors.text, fontSize: 22, fontWeight: "500" },
  stepValue: { minWidth: 56, textAlign: "center", color: colors.text, fontSize: 15, fontWeight: "600" },
});
