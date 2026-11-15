/** Normalized crop rectangle (0..1 of the source frame). */
export type Roi = { x: number; y: number; w: number; h: number };

export type FrameSource = HTMLVideoElement | HTMLImageElement;

export function sourceSize(src: FrameSource): { width: number; height: number } {
  if (src instanceof HTMLVideoElement) {
    return { width: src.videoWidth, height: src.videoHeight };
  }
  return { width: src.naturalWidth, height: src.naturalHeight };
}

export function sourceReady(src: FrameSource | null): src is FrameSource {
  if (!src) return false;
  const { width, height } = sourceSize(src);
  return width > 0 && height > 0;
}

function cropRect(src: FrameSource, roi: Roi | null) {
  const { width, height } = sourceSize(src);
  const r = roi ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    sx: Math.round(r.x * width),
    sy: Math.round(r.y * height),
    sw: Math.max(1, Math.round(r.w * width)),
    sh: Math.max(1, Math.round(r.h * height)),
  };
}

/**
 * Scale factor for a crop of `sw` x `sh` source pixels: shrink anything whose
 * long side is over `maxSide`, enlarge anything under `minLong`.
 *
 * Enlarging adds no real detail, but Claude sees an image in patches of
 * roughly 28px. A 200px-wide board would get under one patch per square, so
 * blowing it up gives the model room to look at each square.
 */
export function cropScale(sw: number, sh: number, maxSide = 1920, minLong = 1024): number {
  const long = Math.max(sw, sh);
  if (long > maxSide) return maxSide / long;
  if (long < minLong) return minLong / long;
  return 1;
}

/**
 * Grab the current frame (cropped to the ROI) as a base64 JPEG, sized with
 * `cropScale`. Current Claude models read up to 2576px; 1920 caps the
 * image-token cost and is already more detail than a video call carries.
 */
export function grabJpeg(
  src: FrameSource,
  roi: Roi | null,
  quality = 0.9,
): { base64: string; width: number; height: number; cropWidth: number; cropHeight: number } {
  const { sx, sy, sw, sh } = cropRect(src, roi);
  const scale = cropScale(sw, sh);
  const width = Math.round(sw * scale);
  const height = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width, height, cropWidth: sw, cropHeight: sh };
}

const SIG_W = 64;
const SIG_H = 36;
let sigCanvas: HTMLCanvasElement | null = null;

/** Tiny grayscale thumbnail used to detect motion and board changes cheaply. */
export function signature(src: FrameSource, roi: Roi | null): Uint8ClampedArray {
  const { sx, sy, sw, sh } = cropRect(src, roi);
  sigCanvas ??= document.createElement("canvas");
  sigCanvas.width = SIG_W;
  sigCanvas.height = SIG_H;
  const ctx = sigCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(SIG_W * SIG_H);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, SIG_W, SIG_H);
  const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H);
  const gray = new Uint8ClampedArray(SIG_W * SIG_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
  }
  return gray;
}

/** Fraction (0..1) of thumbnail pixels that changed noticeably. */
export function changedFraction(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 28): number {
  if (a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > threshold) changed++;
  }
  return changed / a.length;
}

/**
 * setInterval that keeps ticking when the tab is in the background.
 * Browsers throttle page timers in hidden tabs (down to once a minute),
 * but dedicated worker timers keep running.
 */
export function createTicker(ms: number, onTick: () => void): () => void {
  const code = `let id; onmessage = (e) => { clearInterval(id); if (e.data > 0) id = setInterval(() => postMessage(0), e.data); };`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  worker.postMessage(ms);
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}
