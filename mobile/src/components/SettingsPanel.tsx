import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { normalizeServerUrl } from "../api";
import { INTERVAL_MAX, INTERVAL_MIN, SPEECH_RATES, type Settings } from "../settings";
import { colors, radius, space } from "../theme";
import { Card, Segmented, SectionTitle, Stepper } from "./ui";

export function SettingsPanel({
  settings,
  update,
  watching,
  initiallyOpen,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  watching: boolean;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const url = normalizeServerUrl(settings.serverUrl);

  return (
    <Card>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" hitSlop={8}>
        <SectionTitle right={<Text style={styles.chevron}>{open ? "Hide" : "Show"}</Text>}>Settings</SectionTitle>
      </Pressable>

      {!open ? (
        <Text style={styles.summary} numberOfLines={1}>
          {url || "No server set"} · {settings.viewer === "w" ? "White" : "Black"} · every {settings.intervalSec}s
        </Text>
      ) : (
        <View style={styles.body}>
          <Field label="Server URL">
            <TextInput
              style={styles.input}
              value={settings.serverUrl}
              onChangeText={(serverUrl) => update({ serverUrl })}
              placeholder="https://your-app.vercel.app"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="done"
            />
            {url ? <Text style={styles.hint}>Sends photos to {url}/api/step</Text> : null}
          </Field>

          <Field label="Access token (APP_TOKEN, optional)">
            <TextInput
              style={styles.input}
              value={settings.token}
              onChangeText={(token) => update({ token })}
              placeholder="Leave empty if the server has no APP_TOKEN"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              returnKeyType="done"
            />
          </Field>

          <Field label="I play">
            <Segmented
              options={[
                { label: "White", value: "w" },
                { label: "Black", value: "b" },
              ]}
              value={settings.viewer}
              onChange={(viewer) => update({ viewer })}
            />
          </Field>

          <View style={styles.inline}>
            <Text style={styles.label}>Photo every</Text>
            <Stepper
              value={settings.intervalSec}
              min={INTERVAL_MIN}
              max={INTERVAL_MAX}
              format={(v) => `${v} s`}
              onChange={(intervalSec) => update({ intervalSec })}
            />
          </View>

          <Field label="Speech speed">
            <Segmented
              options={SPEECH_RATES.map((r) => ({ label: `${r}×`, value: r }))}
              value={settings.speechRate}
              onChange={(speechRate) => update({ speechRate })}
            />
          </Field>

          <Field label="Glasses stream quality">
            <Segmented
              options={[
                { label: "Low", value: "low" },
                { label: "Medium", value: "medium" },
                { label: "High", value: "high" },
              ]}
              value={settings.streamQuality}
              onChange={(streamQuality) => update({ streamQuality })}
            />
            <Text style={styles.hint}>
              Photos need a running video stream. Low saves battery. If photo sizes in the move card look small, try
              High.{watching ? " Applies next time you start watching." : ""}
            </Text>
          </Field>
        </View>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: { color: colors.blue, fontSize: 13, fontWeight: "600" },
  summary: { color: colors.textDim, fontSize: 13 },
  body: { gap: space.lg, marginTop: space.xs },
  field: { gap: 6 },
  inline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
  },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
});
