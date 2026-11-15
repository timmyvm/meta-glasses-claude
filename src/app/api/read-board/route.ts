import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ReadBoardRequest, ReadBoardResponse } from "@/lib/api-types";

// Haiku is fast and costs about a tenth of a cent per read, which is plenty
// for clear photos. For blurry or cluttered shots, set CLAUDE_MODEL in
// .env.local to claude-sonnet-5-5 or claude-opus-5-5 (slower, pricier, sharper).
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

// Created lazily so a missing key surfaces as a request error, not a build error.
let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const BoardRead = z.object({
  board_visible: z
    .boolean()
    .describe("false if the board is not fully visible, too blurry, or hands are covering squares"),
  rows_far_to_near: z
    .array(z.string())
    .describe(
      "Exactly 8 strings. First = the row of squares farthest from the camera, last = nearest. " +
        "Each string is exactly 8 characters, the squares from left to right as seen in the image. " +
        "White pieces uppercase P N B R Q K, black pieces lowercase p n b r q k, empty square '.'",
    ),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().describe("Short note on anything uncertain, else empty"),
});

const SYSTEM = `You transcribe physical chess boards from photos. The photos come from a camera built into smart glasses worn by one of the players, so the board is usually seen at an angle from that player's seat, possibly with motion blur, glare, or a hand in frame.

Your only job is an exact square-by-square transcription of where every piece stands. Work methodically:
1. Find the 8x8 grid and its four corners, even when seen in perspective. Rows nearer the camera look larger; far rows are compressed. Count squares carefully, don't guess from piece spacing.
2. Go row by row, far to near, left to right, and decide for every square whether it holds a piece.
3. For each piece, decide its color (light pieces are White, dark pieces are Black) and its type. Kings are the tallest pieces with a cross on top; queens have a coronet; bishops have a slit mitre; knights are horse heads; rooks are castle towers; pawns are the small round ones.
4. Tall pieces lean "up" in the image and can overlap the square behind them. Assign each piece to the square its base stands on.

Each side always has exactly one king. If the board is not fully in frame, is too blurry to read, or pieces are covered, set board_visible to false rather than guessing.`;

function viewerHint(viewer: "w" | "b") {
  return viewer === "w"
    ? "The wearer is playing White, so White's pieces start on the side nearest the camera."
    : "The wearer is playing Black, so Black's pieces start on the side nearest the camera.";
}

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  let body: ReadBoardRequest;
  try {
    body = (await req.json()) as ReadBoardRequest;
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.image || typeof body.image !== "string") {
    return json({ ok: false, error: "missing image" }, 400);
  }
  const viewer = body.viewer === "b" ? "b" : "w";
  const effort = body.effort ?? "medium";

  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Opus 5.5 always thinks; effort sets how hard. "low" is fastest.
      output_config: { effort, format: betaZodOutputFormat(BoardRead) },
      // If the model declines a request, retry on its default fallback model.
      // Models without a fallback (like Haiku) simply run on their own.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: body.image },
            },
            {
              type: "text",
              text: `${viewerHint(viewer)} Transcribe the board exactly as it appears in this image (far row first, left to right).`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return json({ ok: false, error: "the model declined to read this image" }, 422);
    }
    if (response.stop_reason === "max_tokens") {
      return json({ ok: false, error: "board read was cut off (max_tokens)" }, 502);
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      return json({ ok: false, error: "could not parse the board read" }, 502);
    }

    return json({
      ok: true,
      visible: parsed.board_visible,
      rows: parsed.rows_far_to_near,
      confidence: parsed.confidence,
      notes: parsed.notes,
      model: response.model,
      ms: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return json({ ok: false, error: "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local" }, 401);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json({ ok: false, error: "rate limited, slow down the read interval" }, 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      return json({ ok: false, error: `bad request: ${error.message}` }, 400);
    }
    if (error instanceof Anthropic.APIError) {
      return json({ ok: false, error: `Claude API error ${error.status}: ${error.message}` }, 502);
    }
    const message = error instanceof Error ? error.message : String(error);
    // The SDK throws a plain Error when no credentials are configured at all.
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return json({ ok: false, error: "No Anthropic API key found. Add ANTHROPIC_API_KEY to .env.local and restart the dev server." }, 401);
    }
    return json({ ok: false, error: message }, 500);
  }
}

function json(data: ReadBoardResponse, status = 200) {
  return Response.json(data, { status });
}
