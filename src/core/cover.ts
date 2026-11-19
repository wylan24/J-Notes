// Custom notebook covers: a picture kept small enough to live on the library record.

/** Largest cover stored, in pixels: about twice the size a library card shows it at. */
export const COVER_MAX_W = 480;
export const COVER_MAX_H = 680;

/** Scale a w×h picture down (never up) to fit within the cover bounds, keeping its proportions. */
export function coverFit(w: number, h: number, maxW = COVER_MAX_W, maxH = COVER_MAX_H): { w: number; h: number } {
  const k = Math.min(1, maxW / Math.max(1, w), maxH / Math.max(1, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** A data URL is too big to be a cover we made (and too big to keep on every library listing). */
const MAX_COVER_CHARS = 1_500_000;

/** Whether a value read from a file is an acceptable cover: a base64 PNG, JPEG or WebP data URL of sensible size. */
export function isCoverDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_COVER_CHARS && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
}
