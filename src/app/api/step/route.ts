/**
 * POST /api/step: one glasses photo in, what to say out. Used by the iPhone
 * app; see src/lib/step-api.ts for the contract.
 */

import { gameStatus, placementOf, uciToSan } from "@/lib/board";
import type { StepRequest, StepResponse, StepSuggestion } from "@/lib/step-api";
import { requireToken } from "@/lib/server/auth";
import { NEW_GATE, CHANGE_MIN, changedFraction, decodeSig, encodeSig, thumbnail, type GateState } from "@/lib/server/gate";
import { readBoardImage } from "@/lib/server/reader";
import { analyzeOnServer } from "@/lib/server/stockfish";
import { describeScore, sanToSpeech } from "@/lib/speech";
import { NEW_GAME, readModeFor, trackStep, type Observation, type TrackerState } from "@/lib/tracker";

// A Claude read plus a Stockfish search; give hosting platforms some headroom.
export const maxDuration = 60;

type Envelope = { t: TrackerState; s: StepSuggestion | null };

function parseEnvelope(raw: unknown): Envelope {
  const e = raw as Partial<Envelope> | null;
  const t = e?.t as Partial<TrackerState> | undefined;
  if (!t || typeof t !== "object" || !("fen" in t)) return { t: { ...NEW_GAME }, s: null };
  return {
    t: {
      fen: typeof t.fen === "string" ? t.fen : null,
      pending: t.pending ?? null,
      pendingUnknown: typeof t.pendingUnknown === "string" ? t.pendingUnknown : null,
      misses: typeof t.misses === "number" ? t.misses : 0,
      lost: Boolean(t.lost),
    },
    s: e?.s && typeof e.s === "object" ? (e.s as StepSuggestion) : null,
  };
}

function parseGate(raw: unknown): GateState {
  const g = raw as Partial<GateState> | null;
  if (!g || typeof g !== "object") return { ...NEW_GATE };
  return { lastReadSig: typeof g.lastReadSig === "string" ? g.lastReadSig : null, recheck: Boolean(g.recheck) };
}

async function bestMove(fen: string, movetimeMs: number): Promise<{ suggestion: StepSuggestion | null; say: string | null }> {
  const status = gameStatus(fen);
  if (status.kind === "checkmate") return { suggestion: null, say: "Checkmate" };
  if (status.kind === "stalemate") return { suggestion: null, say: "Stalemate" };
  if (status.kind === "invalid") return { suggestion: null, say: null };
  const a = await analyzeOnServer(fen, movetimeMs);
  if (!a.bestmove) return { suggestion: null, say: null };
  const san = uciToSan(fen, a.bestmove) ?? a.bestmove;
  const suggestion: StepSuggestion = {
    fen,
    uci: a.bestmove,
    san,
    spoken: sanToSpeech(san),
    score: describeScore(a.scoreCp, a.mate),
  };
  return { suggestion, say: suggestion.spoken };
}

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const denied = requireToken(req);
  if (denied) return denied;

  let body: StepRequest;
  try {
    body = (await req.json()) as StepRequest;
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.image || typeof body.image !== "string") return json({ ok: false, error: "missing image" }, 400);

  const viewer = body.viewer === "b" ? "b" : "w";
  const rotated = Boolean(body.rotated);
  const trigger = body.trigger === "manual" ? "manual" : "auto";
  const movetime = Math.min(5000, Math.max(100, Number(body.movetimeMs) || 800));
  const env = parseEnvelope(body.state);
  const gate = parseGate(body.gate);

  // Skip photos that look the same as the last one we read.
  const sig = await thumbnail(body.image);
  if (trigger === "auto" && !gate.recheck && sig && gate.lastReadSig) {
    if (changedFraction(sig, decodeSig(gate.lastReadSig)) < CHANGE_MIN) {
      return json({
        ok: true,
        state: env,
        gate,
        skipped: true,
        say: null,
        suggestion: env.s,
        myTurn: env.t.fen ? env.t.fen.split(" ")[1] === viewer : null,
        placement: env.t.fen ? placementOf(env.t.fen) : null,
        log: [],
        recheckSoon: false,
        ms: Date.now() - started,
      });
    }
  }

  const mode = readModeFor(env.t);
  const read = await readBoardImage({
    image: body.image,
    viewer,
    mode,
    effort: body.effort ?? (mode === "occupancy" ? "low" : "medium"),
  });
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);

  const obs: Observation = read.visible
    ? { kind: "rows", mode, rows: read.rows, confidence: read.confidence }
    : { kind: "unreadable", notes: read.notes };
  const r = trackStep(env.t, obs, { viewer, rotated, trigger });

  let suggestion = r.clearSuggestion ? null : env.s;
  let say: string | null = r.notice;
  const target = r.analyze ?? (r.repeat && r.state.fen && suggestion?.fen !== r.state.fen ? r.state.fen : null);
  if (target) {
    const best = await bestMove(target, movetime);
    suggestion = best.suggestion;
    say = best.say ?? say;
  } else if (r.repeat && suggestion) {
    say = suggestion.spoken;
  }

  return json({
    ok: true,
    state: { t: r.state, s: suggestion } satisfies Envelope,
    gate: { lastReadSig: sig ? encodeSig(sig) : gate.lastReadSig, recheck: r.recheck } satisfies GateState,
    skipped: false,
    say,
    suggestion,
    myTurn: r.myTurn,
    placement: r.state.fen ? placementOf(r.state.fen) : null,
    log: [...r.log, { level: "info", text: `read (${mode}) in ${(read.ms / 1000).toFixed(1)}s` }],
    recheckSoon: r.recheck,
    ms: Date.now() - started,
  });
}

function json(data: StepResponse, status = 200) {
  return Response.json(data, { status });
}
