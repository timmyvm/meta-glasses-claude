# IRL Engine

Play over-the-board chess with Meta Ray-Ban glasses on. The glasses stream what you see over a video call to your laptop. Claude reads the board, Stockfish finds the best move, and a voice says it in your ear through the glasses' speakers.

```
Glasses camera ──video call──▶ laptop (this app)
                                 │  screen-share the call window
                                 ▼
                       Claude vision: photo → board position
                                 │
                                 ▼
                    Stockfish 19 (WASM, runs in the browser)
                                 │
                                 ▼
                 "Knight F3" (text-to-speech) ──call audio──▶ glasses speakers
```

> **Fair play:** using this in rated or tournament games is cheating and will get you banned. Use it for casual games with friends who know, training, or analysing positions.

## Quick start

```bash
npm install            # also copies the Stockfish engine into public/stockfish
cp .env.example .env.local
# put your Anthropic API key in .env.local
npm run dev
```

Open http://localhost:3000 in Chrome. Without the glasses you can test with **Use webcam** (point a laptop webcam at a board) or **Upload photo**, then press **Read board** (or Space).

## Glasses setup

1. **Laptop:** sign in to WhatsApp Desktop (or Messenger) with a second account, so the glasses can call it.
2. **Glasses:** start a video call to that account ("Hey Meta, video call …") and switch the call to the glasses camera (double-press the capture button, or use the switch-camera button in the call on your phone).
3. **Laptop:** answer the call, then in this app click **Share call window**. In the picker, choose the **Window** tab and pick the WhatsApp/Messenger window, not "Entire screen". With the whole screen, the call video is a tiny part of a huge frame.
4. **Drag a box around the glasses video** inside the shared window. The crop comes from the full-resolution capture, so the board gets far more detail, and the call buttons and self-view are left out.
5. Choose **I'm playing White/Black**. The app assumes you sit behind your own pieces.

Keep this browser window visible on screen (side by side with the call is fine). Chrome slows down hidden tabs.

### Sharp, uncropped picture

The app captures the call window exactly as it looks on screen. The badge in the corner of the video shows the capture size; it turns amber below 600px. The crop box shows how many real pixels it covers, which is the detail Claude actually gets; under 300px it turns amber. Small crops are enlarged to 1024px before sending, so the model has more image to look at per square, but that can't add detail the video never had.

- **Make the call window tall and narrow.** The glasses send portrait video. In a wide window, WhatsApp zooms in to fill it and cuts off the top and bottom, so you lose field of view. A portrait-shaped window shows the whole frame.
- **Make it as big as you can.** The capture is only as big as the window, so put the call window full height on screen and the app side by side with it (or on a second monitor).
- **Use a strong connection.** WhatsApp lowers video quality when the phone's connection is weak, and the glasses stream through the phone. Strong Wi-Fi on both the phone and laptop helps.
- **Look at the board from closer.** The board then fills more of the frame, and a tight crop around it gets more detail.

Even at its best, call video is a lot softer than glasses photos. If boards still misread, set Read quality to **Careful**.

## Getting the voice into the call

The app speaks with the browser's text-to-speech, so that audio has to reach the call's **microphone** on the laptop.

**Mac (recommended):** install the free [BlackHole 2ch](https://existential.audio/blackhole/) virtual audio device.
- System Settings → Sound → Output: **BlackHole 2ch** (Chrome's speech goes here)
- In WhatsApp/Messenger call settings: Microphone **BlackHole 2ch**, Speaker **your normal speakers/headphones**

**Windows:** install [VB-CABLE](https://vb-audio.com/Cable/).
- Settings → System → Sound → Volume mixer → set **Chrome**'s output to **CABLE Input**
- In WhatsApp/Messenger call settings: Microphone **CABLE Output**

**Quick and dirty:** leave everything default and let the laptop mic pick up the laptop speakers. It works in a quiet room, but the call's noise suppression can eat the voice.

Use **Test voice** to check that you hear "Knight F3" through the glasses.

## How it decides when to speak

- **Auto-watch** grabs a small thumbnail every 400 ms. Once the picture has been still for about a second, and looks different from the last board it read, it sends one frame to Claude.
- Every new board is compared with the last one by trying every legal move (and every pair of moves, in case one was missed). That way the app knows who moved, and it keeps castling rights and en passant correct.
  - **Opponent moved:** Stockfish thinks, then the move is spoken.
  - **You moved:** it stays quiet.
  - **The board doesn't follow from a legal move** (a misread, or a hand mid-move): it reads again to confirm before trusting it.
- **Read board** (Space) forces a read and a suggestion. **Say again** (R) repeats the last move.

## Settings worth knowing

| Setting | What it does |
| --- | --- |
| Read quality | How hard Claude thinks while reading the board. **Fast** is quicker; **Careful** makes fewer mistakes on angled or cluttered shots. |
| Engine time | How long Stockfish thinks. 1–2 s is already far beyond human strength. |
| Min gap | Minimum seconds between automatic reads. Each read is one API call, so this caps cost. |
| Board looks flipped | Use this if reads come out upside down (for example, you're watching from the other side). |

**Cost and speed:** each read is one image plus a short reply, so expect a few cents per read with the default model (`claude-opus-5-5`). Reads take a few seconds. For faster or cheaper reads, set `CLAUDE_MODEL` in `.env.local` (for example `claude-sonnet-5-5`). The API route also enables Claude's server-side fallback: if the model declines a request, it retries on a fallback model.

## Code map

| File | Job |
| --- | --- |
| `src/app/api/read-board/route.ts` | Sends a frame to Claude with a JSON schema and returns 8 rows of the board as seen in the image |
| `src/lib/board.ts` | Turns rows into a FEN based on the viewer's side, finds the move that happened, decides whose turn it is |
| `src/lib/engine.ts` | Small UCI wrapper around Stockfish running in a Web Worker |
| `src/lib/speech.ts` | Converts SAN to speech-friendly text (`Nbd2` → "Knight B, D2") and speaks it |
| `src/lib/frames.ts` | Frame capture, cropping, motion detection, and a background-safe ticker |
| `src/components/Coach.tsx` | The app: sources, auto-watch loop, state, UI |

```bash
npm test        # unit tests for board logic and speech
npm run build
```

## Ideas for v2

- **Native glasses app:** Meta's Wearables Device Access Toolkit gives an iOS/Android app direct access to the glasses camera and speakers. That would replace the video call hack and cut latency.
- **Local board detector:** a small on-device model (board corners + square classifier) for instant reads, with Claude as a fallback when it's unsure.
- **Voice trigger:** say "move?" and the app hears it through the call audio.

Stockfish is GPL-3.0 (see `node_modules/stockfish/Copying.txt`).
