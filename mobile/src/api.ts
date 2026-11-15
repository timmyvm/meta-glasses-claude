/**
 * Client for POST /api/step on the IRL Engine Next.js server.
 *
 * The types below are copied from ../src/lib/step-api.ts in the repo root
 * (this project can't import from the parent folder). Keep them in sync by hand
 * if the server contract changes.
 */

// ---- Copied from src/lib/api-types.ts ----
export type ReadEffort = "low" | "medium" | "high";

// ---- Copied from src/lib/step-api.ts ----
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

export type StepOk = Extract<StepResponse, { ok: true }>;

// ---- Client ----

const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Accepts what people actually type ("192.168.1.20:3000", "my-app.vercel.app/")
 * and returns a base URL without a trailing slash.
 * IPs, localhost and anything with a port default to http://, everything else to https://.
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split("/")[0];
    const looksLocal =
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) ||
      /^localhost(:\d+)?$/i.test(host) ||
      /\.local(:\d+)?$/i.test(host) ||
      /:\d+$/.test(host);
    url = `${looksLocal ? "http" : "https"}://${url}`;
  }
  return url;
}

export class StepError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StepError";
  }
}

export async function postStep(
  serverUrl: string,
  token: string,
  body: StepRequest,
): Promise<StepOk> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new StepError("Set the server URL in Settings first.");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}/api/step`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new StepError(`Server took longer than ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new StepError(`Can't reach ${base} (${errorText(err)}).`);
  } finally {
    clearTimeout(timer);
  }

  let data: StepResponse | null = null;
  try {
    data = (await res.json()) as StepResponse;
  } catch {
    // Non-JSON body (proxy error page, 404 HTML, ...). Handled below.
  }

  if (res.status === 401 || res.status === 403) {
    throw new StepError("Server rejected the access token (check Settings).", res.status);
  }
  if (!data) {
    throw new StepError(
      res.status === 404
        ? `No /api/step on ${base} (is the server up to date?).`
        : `Server answered HTTP ${res.status} without JSON.`,
      res.status,
    );
  }
  if (!data.ok) throw new StepError(data.error || `Server error (HTTP ${res.status}).`, res.status);
  return data;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
