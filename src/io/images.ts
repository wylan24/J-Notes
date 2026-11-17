import { decodeImage } from '../render/items';

/** Longest side, in pixels, that an inserted photo is stored at. Phone photos are much larger. */
const MAX_SIDE = 2400;

export interface PreparedImage {
  type: string;
  bytes: ArrayBuffer;
  img: HTMLImageElement;
  width: number;
  height: number;
}

export const isImageFile = (f: File) => f.type.startsWith('image/');

/**
 * Decode an image file, downscaling very large ones so notebooks stay small.
 * PNGs stay PNG (they may be transparent); other formats are re-encoded as JPEG when downscaled.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const img = await decodeImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error('This image has no size');
  const k = MAX_SIDE / Math.max(width, height);
  if (k >= 1) return { type: file.type || 'image/png', bytes: await file.arrayBuffer(), img, width, height };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const small = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!small) throw new Error('Could not resize this image');
  return { type, bytes: await small.arrayBuffer(), img: await decodeImage(small), width: canvas.width, height: canvas.height };
}
