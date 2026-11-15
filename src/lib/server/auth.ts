import { timingSafeEqual } from "node:crypto";

/**
 * Optional shared secret. When APP_TOKEN is set (do this before putting the
 * server on the internet), requests must send `Authorization: Bearer <token>`,
 * so strangers can't spend your Claude credits.
 * Returns an error response, or null when the request may proceed.
 */
export function requireToken(req: Request): Response | null {
  const expected = process.env.APP_TOKEN;
  if (!expected) return null;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return Response.json(
    { ok: false, error: "Missing or wrong access token. Set it to the server's APP_TOKEN." },
    { status: 401 },
  );
}
