/**
 * Cheap "did anything change?" check for phone photos, so unchanged shots
 * don't cost a Claude call. Shrinks each photo to a tiny grayscale thumbnail
 * and compares it with the last photo that was actually read.
 */

export type GateState = {
  /** base64 of the last read photo's thumbnail */
  lastReadSig: string | null;
  /** read the next photo regardless (a move is waiting for confirmation) */
  recheck: boolean;
};

export const NEW_GATE: GateState = { lastReadSig: null, recheck: false };

const W = 64;
const H = 48;
/** Under this fraction of thumbnail pixels changing, call it the same picture. */
export const CHANGE_MIN = 0.004;

export async function thumbnail(jpegBase64: string): Promise<Uint8Array | null> {
  try {
    const sharp = (await import("sharp")).default;
    const raw = await sharp(Buffer.from(jpegBase64, "base64"))
      .rotate()
      .resize(W, H, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();
    return new Uint8Array(raw);
  } catch {
    return null; // no gate if the image library isn't available; every photo gets read
  }
}

export function changedFraction(a: Uint8Array, b: Uint8Array, threshold = 28): number {
  if (a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) changed++;
  return changed / a.length;
}

export const encodeSig = (sig: Uint8Array) => Buffer.from(sig).toString("base64");
export const decodeSig = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
