/**
 * Contract for POST /api/step, the endpoint the iPhone app talks to.
 *
 * The phone sends one photo per call. The server does everything else: skips
 * photos that look unchanged, reads the board with Claude, tracks the game,
 * runs Stockfish, and replies with what (if anything) to say.
 *
 * `state` and `gate` are opaque to the client: send back exactly what the last
 * response returned (or null to start a new game).
 *
 * If the server has APP_TOKEN set, send `Authorization: Bearer <APP_TOKEN>`.
 */

import type { ReadEffort } from "@/lib/api-types";

export type StepRequest = {
  /** base64 JPEG without a data: prefix. ~1600px on the long side is plenty. */
  image: string;
  /** Color the glasses wearer plays. */
  viewer: "w" | "b";
  /** Board appears upside down from what `viewer` implies. */
  rotated?: boolean;
  effort?: ReadEffort;
  /** "manual" = the wearer asked for a move right now (skips the change gate). */
  trigger: "auto" | "manual";
  /** Stockfish think time, default 800ms. */
  movetimeMs?: number;
  state: unknown | null;
  gate: unknown | null;
};

export type StepSuggestion = {
  fen: string;
  uci: string;
  san: string;
  spoken: string;
  score: string;
};

export type StepResponse =
  | {
      ok: true;
      state: unknown;
      gate: unknown;
      /** true when the photo looked unchanged, so no board read happened. */
      skipped: boolean;
      /** Speak this now, or stay quiet when null. */
      say: string | null;
      suggestion: StepSuggestion | null;
      /** Whose move it is by the tracker, null before the first good read. */
      myTurn: boolean | null;
      /** Tracked board as a FEN piece placement, for display. */
      placement: string | null;
      log: { level: "info" | "warn"; text: string }[];
      /** Send the next photo right away (a move is waiting for confirmation). */
      recheckSoon: boolean;
      ms: number;
    }
  | { ok: false; error: string };
