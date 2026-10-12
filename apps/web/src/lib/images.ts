/** Longest edge after resizing. Plenty for staff to judge furniture, small enough for mobile data. */
export const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export class ImageError extends Error {
  constructor(readonly reason: "unsupported" | "too_large") {
    super(reason);
  }
}

export const isHeic = (file: File) =>
  /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // Safari decodes HEIC natively; "from-image" applies the EXIF rotation.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (!isHeic(file)) throw new ImageError("unsupported");
    // Only browsers that cannot decode HEIC themselves download the ~3 MB decoder.
    // The csp build avoids eval, so it works under the site's Content-Security-Policy.
    const { heicTo } = await import("heic-to/csp");
    try {
      return await heicTo({ blob: file, type: "bitmap" });
    } catch {
      throw new ImageError("unsupported");
    }
  }
}

/**
 * Decodes, rotates and scales a photo, then re-encodes it as JPEG.
 * Re-encoding through a canvas drops all metadata, including GPS position.
 */
export async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageError("unsupported");
    ctx.fillStyle = "#fff"; // JPEG has no transparency; avoid black backgrounds from PNGs
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ImageError("unsupported"))),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}
