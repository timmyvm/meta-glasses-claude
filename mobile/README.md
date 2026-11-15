# IRL Engine for iPhone

A small iPhone app that sits between your Ray-Ban Meta glasses and the IRL Engine server:

```
Glasses camera ──(Meta Wearables toolkit)──▶ iPhone app ──photo every few seconds──▶ your server /api/step
                                                 ▲                                         │
                                                 └──────── "Knight F3" ◀───────────────────┘
                                         spoken with iOS text-to-speech, which plays
                                         in the glasses (they're your Bluetooth headphones)
```

The phone does no chess. It takes a photo, shrinks it, sends it to the server, and says whatever the server tells it to say. Board reading (Claude), move tracking and Stockfish all live in the Next.js app in the repo root.

> **Fair play:** using this in rated or tournament games is cheating. Use it for casual games with people who know, or for training.

You're on Windows with an iPhone, so you'll never touch Xcode. Expo's cloud service (EAS) builds the iPhone app for you, and you install it from a link.

---

## 1. Accounts and one-time setup

You need:

1. **Apple Developer account** (the paid one, you have it). EAS uses it to sign the app.
2. **Expo account** (free): sign up at https://expo.dev/signup.
3. **Meta AI app** on the iPhone, signed in, with your glasses paired and working.
4. **Developer Mode for the glasses, turned on in the Meta AI app.** This lets an app that isn't registered with Meta (like this one) use the glasses camera. Meta moves this setting around, so check their docs for the exact toggle: https://wearables.developer.meta.com/docs/develop
5. **Node.js LTS** on your PC: https://nodejs.org

There are **two different "Developer Mode" switches**, and you need both:

- the **glasses** one, in the Meta AI app (step 4 above), and
- the **iPhone** one: Settings → Privacy & Security → Developer Mode → On (the phone restarts). iOS needs it to open the development build, and may ask for it for the preview build too. The switch often only appears after you've installed such an app once, so if you can't find it yet, come back after step 3.

## 2. Make the server reachable from the phone

The phone talks to the Next.js app in the repo root (`POST /api/step`). It has to reach it over the network. Pick one:

**A. Deploy it (best for playing).** Deploy the repo root to Vercel, set `ANTHROPIC_API_KEY` in the Vercel project's environment variables, and use the URL it gives you, e.g. `https://your-app.vercel.app`. Works anywhere the phone has internet.

**B. Run it on your PC (quick for testing).** Phone and PC on the same Wi-Fi.

```bash
# in the repo root, not in mobile/
npm run dev -- -H 0.0.0.0
```

Find your PC's address: run `ipconfig` in a terminal and look for **IPv4 Address** under your Wi-Fi adapter, e.g. `192.168.1.23`. The server URL for the app is then `http://192.168.1.23:3000`.

- When Windows asks whether Node.js may use the network, allow **Private networks**.
- The first time the app connects, iPhone asks to "find and connect to devices on your local network". Tap **Allow**. (If you tapped Don't Allow: iPhone Settings → Privacy & Security → Local Network → IRL Engine.)
- Your PC's IP can change after a reboot. If the app suddenly can't reach the server, check `ipconfig` again.

**Access token (optional but a good idea once deployed).** If you set `APP_TOKEN=some-long-random-string` in the server's environment (`.env.local` locally, or Vercel's environment variables), the server rejects requests without it. Put the same string in the app under Settings → Access token. It's stored in the iPhone keychain.

## 3. Build and install the app

All commands run on your PC in a terminal.

```bash
cd mobile
npm install
npm install -g eas-cli     # the EAS command-line tool (note: `npx eas` is a different, unrelated package)
eas login                  # your Expo account
```

### Development build (for trying things out)

```bash
eas build -p ios --profile development
```

The first time, EAS asks a few questions:

- **Create an EAS project?** Yes. It adds a project ID to `app.json`; commit that change.
- **Log in to your Apple account?** Yes. Let EAS create the certificates and provisioning profile for you.
- **Register devices?** Yes. EAS shows a link / QR code. Open it **on the iPhone** and install the profile it offers (Settings → General → VPN & Device Management if it doesn't open by itself). This tells Apple your iPhone may run the app. If you skip this, the build won't install on your phone. You can also do it any time with `eas device:create`, then build again.

The build runs in Expo's cloud (expect 10–30 minutes; free accounts wait in a slower queue and have a monthly build allowance). When it's done, EAS gives you a link/QR code. Open it on the iPhone to install. Turn on the iPhone's Developer Mode when iOS asks (see section 1).

A development build doesn't contain your app's code yet; it loads it from your PC while you develop:

```bash
npx expo start --dev-client
```

Open **IRL Engine** on the iPhone. It should list your PC's server; tap it (or scan the QR code in the terminal with the iPhone camera). Phone and PC must be on the same Wi-Fi. If it can't connect, allow Node.js through the Windows firewall, or use `npx expo start --dev-client --tunnel`.

From now on, editing anything in `mobile/src/` reloads the app instantly. You only need a new `eas build` when you change `app.json`, add/remove a native package, or upgrade Expo.

### Preview build (what you take to the board)

```bash
eas build -p ios --profile preview
```

Same install flow, but the app's code is baked in, so it runs on its own without your PC and without Metro. (The chess server still has to be reachable, so a deployed server is the easy option here.) The "Test with phone camera" button only exists in development builds.

Rebuild the preview whenever you want your latest code in the standalone app.

## 4. Using it at the board

1. Make sure the glasses are on, unfolded, and connected to the phone (the Meta AI app shows them connected).
2. Open IRL Engine and tap **Connect glasses**. The Meta AI app opens; approve IRL Engine, and it returns to IRL Engine. The button then says **Allow glasses camera**: tap it and approve in Meta AI again. The header pill should say **Connected**.
3. Open **Settings**: server URL, access token (if you set one), and **I play White / Black**. Photo interval (default 3 s) and speech speed are there too.
4. Tap **Test voice**. You should hear "Knight F3" in the glasses. If it comes out of the phone speaker instead, the glasses aren't the phone's current audio output: check Bluetooth in Control Center. Speech plays even with the phone on silent.
5. Tap **Start watching**. The glasses camera turns on (its capture LED lights up, so people around you can see it), the small preview shows what the glasses see, and a photo goes to the server every few seconds. Look at the board for a moment so it's in frame.
6. When the server says it's your move, you hear it in the glasses, the big card shows it, and the board highlights the from/to squares.

Buttons:

- **Ask now**: take a photo right away and ask for a move, even if the board looks unchanged.
- **Say again**: repeat the last thing it said.
- **New game**: forget the tracked game (the server starts fresh from the next photo).
- **Stop watching**: turn the glasses camera off (saves battery).

**Keep the app open on screen.** Meta's toolkit can't use the glasses camera while the app is in the background, so the app keeps the screen awake while watching. If you lock the phone or switch apps, watching pauses, and it resumes when you come back to IRL Engine. The tracked game survives an app restart until you press New game.

## 5. Testing without the glasses

In a **development** build, the controls section has **Test with phone camera**. It turns on Meta's Mock Device Kit: a simulated pair of glasses whose camera is the iPhone's back camera.

1. Tap **Test with phone camera** and allow camera access.
2. Set the server URL and your color, then **Start watching**.
3. Point the phone at a board (from roughly where your head would be).

What this does and doesn't test:

- It runs the whole loop through the same code path as the real glasses: session, stream, photo capture, resize, upload, server, speech.
- According to Meta's Mock Device Kit docs, when the mock camera is the phone camera, a photo capture returns a live still from that camera, so you don't need to load a fixed test image. This hasn't been tried on a device yet. If photos never arrive in test mode (the log says "No photo from the glasses after 10s"), that's the part that didn't behave as documented.
- Photos come from the phone camera, so their size and quality say nothing about the real glasses.
- It doesn't exercise registration with Meta AI, the Bluetooth link, or audio in the glasses (speech plays from the phone or whatever headphones are connected).

Tap the button again to turn test mode off.

## 6. Known unknowns

None of this has been run on a real iPhone or real glasses yet. It typechecks, its JavaScript bundles, and `expo prebuild` produces the expected iOS project, but no build has gone through EAS and no photo has come from the glasses. Things to watch on the first run:

- **Photo resolution from the glasses.** Photos can only be taken while a video stream runs, and the app starts a low-resolution stream to save battery. Nobody has checked whether photo resolution follows the stream setting. The move card shows the size of each photo (`original → sent`). If photos come back small (say 360×640), set **Settings → Glasses stream quality** to High and start watching again.
- **Capture latency.** The move card shows how long each photo took to arrive ("photo 0.8s") and the round trip to the server. A slow capture plus a slow server read means you hear moves a few seconds late.
- **Battery.** Streaming video from the glasses drains both the glasses and the phone, and the phone screen stays on. Stop watching between games.
- **Capture LED.** The glasses' privacy LED stays on the whole time you're watching. That's by design and can't be turned off.
- **New Architecture.** Expo SDK 58 / React Native 0.88 always use React Native's New Architecture (there's no off switch any more). The glasses module (`expo-meta-wearables-dat`) lists the New Architecture as "untested". It's built on Expo's module API, which supports it, so it should be fine, but if the app crashes when you touch anything glasses-related, this is the first suspect.
- **Developer Mode setup.** The app is set up for the glasses' Developer Mode (no Meta app ID). Whether the toolkit accepts the empty app ID that the plugin writes in that mode is something only the first real run will show.

## Settings that live in `app.json`

- **Bundle identifier**: `ios.bundleIdentifier` is `com.irlengine.app`. Apple bundle IDs are globally unique, so if EAS says it's taken, change it to something like `com.yourname.irlengine` and build again.
- **Plugin order matters.** In `plugins`, `expo-build-properties` must stay **above** `expo-meta-wearables-dat`. The glasses plugin forces the iOS deployment target to 16.0, but Expo SDK 58 needs at least 16.4 and Meta's toolkit asks for 17.0. Config plugins apply their changes bottom-up, so the plugin listed higher wins; listed first, `expo-build-properties` sets 17.0. Swap them and the iOS build fails while installing pods.
- **Meta app ID and client token.** In Developer Mode you don't need them. To use the glasses without Developer Mode (for example to share the app with other people), register the app in the Meta Wearables Developer Center (https://wearables.developer.meta.com/) and add the values to the plugin options, then build again:

  ```json
  [
    "expo-meta-wearables-dat",
    {
      "urlScheme": "irlengine",
      "metaAppId": "YOUR_META_APP_ID",
      "clientToken": "YOUR_CLIENT_TOKEN",
      "bluetoothUsageDescription": "..."
    }
  ]
  ```

  The URL scheme registered there must be `irlengine`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| "Can't reach http://…" | Same Wi-Fi? Server started with `-H 0.0.0.0`? PC IP changed? Windows firewall? iPhone Settings → Privacy & Security → Local Network → IRL Engine on? |
| "Server rejected the access token" | The token in the app must match `APP_TOKEN` on the server exactly. |
| "No /api/step on …" | The server you're pointing at is an older version without the endpoint. Pull and redeploy. |
| Connect glasses opens Meta AI but nothing happens back in the app | Glasses Developer Mode on in Meta AI? Come back to IRL Engine manually; it re-checks when it returns to the foreground. |
| Header says "Registered" but never "Connected" | Glasses on, unfolded, and connected in the Meta AI app? |
| "Glasses are folded" / "too hot" in the log | Unfold them / let them cool. Watching keeps retrying the stream every 10 s. |
| Voice comes from the phone, not the glasses | The glasses aren't the active Bluetooth audio output. Check Control Center → AirPlay/audio output. |

## Project layout

```
mobile/
  App.tsx                    app root: safe area, status bar, audio session
  app.json                   Expo config (name, bundle ID, plugins, permissions)
  eas.json                   EAS build profiles: development, preview, production
  src/
    api.ts                   /api/step types (copied from ../src/lib/step-api.ts) and the fetch client
    settings.ts              settings + saved game (AsyncStorage; token in the keychain)
    photo.ts                 resize to ≤1600 px, JPEG 0.85, base64, delete temp files
    speech.ts                audio session + text-to-speech
    chess.ts                 FEN placement → board squares, glyphs
    theme.ts                 colors and spacing
    hooks/
      useGlasses.ts          registration, permission, stream session, photo capture, mock device
      useWatcher.ts          the capture → upload → speak loop
      useSettings.ts         load/save settings
      useLog.ts              on-screen log
    components/              Header, MoveCard, LivePreview, BoardGrid, Controls, SettingsPanel, LogList, ui
    screens/HomeScreen.tsx   the one screen
```

If the server contract in `../src/lib/step-api.ts` changes, update the copied types at the top of `src/api.ts` to match.

Useful commands (inside `mobile/`):

```bash
npm run typecheck        # TypeScript check
npm run doctor           # expo-doctor: dependency and config sanity checks
npm run build:dev        # eas build -p ios --profile development
npm run build:preview    # eas build -p ios --profile preview
npm start                # expo start --dev-client
```
