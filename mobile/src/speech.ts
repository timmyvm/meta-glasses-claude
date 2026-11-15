import { setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";

/**
 * Put the iOS audio session in "playback" mode so speech is audible even with
 * the ring/silent switch on silent, and briefly lowers (ducks) other audio.
 * Output follows the normal iOS route: when the glasses are connected as
 * Bluetooth headphones, that's the glasses' speakers.
 */
export async function configureAudio(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    allowsRecording: false,
    shouldPlayInBackground: false,
  });
}

/** Speak `text`, cutting off anything currently being said. */
export async function speak(text: string, rate: number): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // Nothing was playing.
  }
  Speech.speak(text, { language: "en-US", rate });
}

export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // ignore
  }
}
