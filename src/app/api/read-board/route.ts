/** POST /api/read-board: one frame in, 8 rows of squares out (used by the browser app). */

import type { ReadBoardRequest, ReadBoardResponse } from "@/lib/api-types";
import { requireToken } from "@/lib/server/auth";
import { readBoardImage } from "@/lib/server/reader";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = requireToken(req);
  if (denied) return denied;

  let body: ReadBoardRequest;
  try {
    body = (await req.json()) as ReadBoardRequest;
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.image || typeof body.image !== "string") {
    return json({ ok: false, error: "missing image" }, 400);
  }

  const result = await readBoardImage({
    image: body.image,
    viewer: body.viewer === "b" ? "b" : "w",
    effort: body.effort ?? "medium",
    mode: body.mode === "occupancy" ? "occupancy" : "full",
  });
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const { ok, visible, rows, confidence, notes, model, ms } = result;
  return json({ ok, visible, rows, confidence, notes, model, ms });
}

function json(data: ReadBoardResponse, status = 200) {
  return Response.json(data, { status });
}
