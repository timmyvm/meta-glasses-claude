import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HomeScreen } from "./src/screens/HomeScreen";
import { configureAudio } from "./src/speech";

export default function App() {
  useEffect(() => {
    // Speech must be audible with the phone on silent, and go to the glasses
    // when they're the connected Bluetooth audio device.
    configureAudio().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}
