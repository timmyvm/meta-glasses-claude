/**
 * Server-side board reader: one photo in, 8 rows of squares out.
 *
 * Two modes:
 * - "full": piece types (K Q R B N P / k q r b n p). Used to start a game or
 *   to resync after losing track.
 * - "occupancy": only W (light piece), B (dark piece) or . per square. Much
 *   easier to read from a soft photo; the tracker matches it to legal moves.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ReadEffort } from "@/lib/api-types";
import type { ReadMode } from "@/lib/tracker";

// Haiku is fast and costs about a tenth of a cent per read, which is plenty
// for clear photos. For blurry or cluttered shots, set CLAUDE_MODEL in
// .env.local to claude-sonnet-5-5 or claude-opus-5-5 (slower, pricier, sharper).
export const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

// Created lazily so a missing key surfaces as a request error, not a build error.
let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const ROWS_SHAPE =
  "Exactly 8 strings. First = the row of squares farthest from the camera, last = nearest. " +
  "Each string is exactly 8 characters, the squares from left to right as seen in the image. ";

const common = {
  board_visible: z
    .boolean()
    .describe("false if the board is not fully visible, too blurry, or hands are covering squares"),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().describe("Short note on anything uncertain, else empty"),
};

const FullRead = z.object({
  board_visible: common.board_visible,
  rows_far_to_near: z
    .array(z.string())
    .describe(ROWS_SHAPE + "White pieces uppercase P N B R Q K, black pieces lowercase p n b r q k, empty square '.'"),
  confidence: common.confidence,
  notes: common.notes,
});

const OccupancyRead = z.object({
  board_visible: common.board_visible,
  rows_far_to_near: z
    .array(z.string())
    .describe(ROWS_SHAPE + "'W' = a light-colored piece stands on the square, 'B' = a dark-colored piece, '.' = empty."),
  confidence: common.confidence,
  notes: common.notes,
});

const SCENE = `The photos come from a camera built into smart glasses worn by one of the players, so the board is seen from that player's seat, possibly with blur, glare, or a hand in frame.`;

const GRID_STEPS = `1. Find the 8x8 grid and its four corners, even when seen in perspective. Rows nearer the camera look larger; far rows are compressed. Count squares carefully, don't guess from piece spacing.
2. Go row by row, far to near, left to right, and decide for every square whether it holds a piece.`;

const BASE_RULE = `Tall pieces lean "up" in the image and can overlap the square behind them. Assign each piece to the square its base stands on.`;

const UNREADABLE = `If the board is not fully in frame, is too blurry to read, or squares are covered, set board_visible to false rather than guessing.`;

const SYSTEM_FULL = `You transcribe physical chess boards from photos. ${SCENE}

Your only job is an exact square-by-square transcription of where every piece stands. Work methodically:
${GRID_STEPS}
3. For each piece, decide its color (light pieces are White, dark pieces are Black) and its type. Kings are the tallest pieces with a cross on top; queens have a coronet; bishops have a slit mitre; knights are horse heads; rooks are castle towers; pawns are the small round ones.
4. ${BASE_RULE}

Each side always has exactly one king. ${UNREADABLE}`;

const SYSTEM_OCCUPANCY = `You check which squares of a physical chess board are occupied. ${SCENE}

For every square, decide only: empty, a light-colored piece (W), or a dark-colored piece (B). You do not need to tell piece types apart. Work methodically:
${GRID_STEPS}
3. For each occupied square, decide whether the piece is from the light set (W) or the dark set (B).
4. ${BASE_RULE}

${UNREADABLE}`;

function viewerHint(viewer: "w" | "b") {
  return viewer === "w"
    ? "The wearer is playing White, so White's pieces start on the side nearest the camera."
    : "The wearer is playing Black, so Black's pieces start on the side nearest the camera.";
}

export type ReadResult =
  | {
      ok: true;
      visible: boolean;
      rows: string[];
      confidence: "high" | "medium" | "low";
      notes: string;
      model: string;
      ms: number;
    }
  | { ok: false; error: string; status: number };

export async function readBoardImage(opts: {
  image: string;
  viewer: "w" | "b";
  effort: ReadEffort;
  mode: ReadMode;
}): Promise<ReadResult> {
  const started = Date.now();
  const occupancy = opts.mode === "occupancy";
  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Thinking is adaptive on current models; effort sets how hard to look.
      output_config: {
        effort: opts.effort,
        format: occupancy ? betaZodOutputFormat(OccupancyRead) : betaZodOutputFormat(FullRead),
      },
      // If the model declines, retry on its default fallback model.
      // Models without a fallback (like Haiku) simply run on their own.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: occupancy ? SYSTEM_OCCUPANCY : SYSTEM_FULL,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.image } },
            {
              type: "text",
              text: `${viewerHint(opts.viewer)} ${
                occupancy
                  ? "Mark every square as W, B or . exactly as it appears in this image (far row first, left to right)."
                  : "Transcribe the board exactly as it appears in this image (far row first, left to right)."
              }`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "the model declined to read this image", status: 422 };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "board read was cut off (max_tokens)", status: 502 };
    }
    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, error: "could not parse the board read", status: 502 };

    return {
      ok: true,
      visible: parsed.board_visible,
      rows: parsed.rows_far_to_near,
      confidence: parsed.confidence,
      notes: parsed.notes,
      model: response.model,
      ms: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local", status: 401 };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "rate limited, slow down the read interval", status: 429 };
    }
    if (error instanceof Anthropic.BadRequestError) {
      return { ok: false, error: `bad request: ${error.message}`, status: 400 };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Claude API error ${error.status}: ${error.message}`, status: 502 };
    }
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return { ok: false, error: "No Anthropic API key found. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.", status: 401 };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
  }
}
