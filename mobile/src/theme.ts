import { Platform } from "react-native";

export const colors = {
  bg: "#0B0D10",
  card: "#14171C",
  cardRaised: "#1B1F26",
  border: "#252A33",
  text: "#F2F4F7",
  textDim: "#A4ADBA",
  textMuted: "#6B7482",
  accent: "#3DDC97", // your move / good
  amber: "#F5B946", // opponent / waiting
  red: "#FF6B6B",
  blue: "#5AA9FF",
  boardLight: "#E6EBF0",
  boardDark: "#93A8BD",
  boardInk: "#14171C",
  highlightFrom: "rgba(245, 185, 70, 0.55)",
  highlightTo: "rgba(61, 220, 151, 0.75)",
} as const;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const mono = Platform.select({ ios: "Menlo", default: "monospace" });
