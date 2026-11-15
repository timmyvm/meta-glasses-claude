import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { PhotoData } from "expo-meta-wearables-dat";

/** Long side of the image sent to the server. The server contract says ~1600px is plenty. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

export type PreparedPhoto = {
  base64: string;
  /** Size of the original photo from the glasses (when known). */
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** Size actually sent. */
  width: number;
  height: number;
  /** Approximate upload size in KB. */
  kb: number;
};

/** The glasses module reports a plain path on iOS; image tools want a file:// URI. */
export function toFileUri(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) return path;
  return `file://${path.startsWith("/") ? "" : "/"}${path}`;
}

export function deleteQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(toFileUri(uri));
    if (f.exists) f.delete();
  } catch {
    // Temp files get cleaned up by iOS eventually anyway.
  }
}

/**
 * Downscale (never upscale) so the long side is <= 1600px, re-encode as JPEG,
 * return base64. Deletes the original glasses photo and the intermediate file.
 */
export async function preparePhoto(photo: PhotoData): Promise<PreparedPhoto> {
  const sourceUri = toFileUri(photo.filePath);
  // Decoding with maxWidth/maxHeight downsamples while loading (fits inside a
  // 1600x1600 box, so the long side ends up <= 1600) and never upscales.
  const context = ImageManipulator.manipulate(sourceUri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE });
  let savedUri: string | null = null;
  try {
    const image = await context.renderAsync();
    try {
      const result = await image.saveAsync({
        base64: true,
        compress: JPEG_QUALITY,
        format: SaveFormat.JPEG,
      });
      savedUri = result.uri;
      if (!result.base64) throw new Error("Image manipulator returned no base64 data.");
      return {
        base64: result.base64,
        sourceWidth: photo.width ?? null,
        sourceHeight: photo.height ?? null,
        width: result.width,
        height: result.height,
        kb: Math.round((result.base64.length * 3) / 4 / 1024),
      };
    } finally {
      image.release();
    }
  } finally {
    context.release();
    deleteQuietly(savedUri);
    deleteQuietly(sourceUri);
  }
}
