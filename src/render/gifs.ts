// Animated GIFs on screen. The canvas only ever draws a GIF's first frame, so animated GIFs are
// decoded here into one canvas per frame, and the on-screen page draws whichever frame is due.
// Everything else (exports, thumbnails, PNG) keeps using the plain image: the first frame.
import { decodeGif, frameAt, isGif } from '../core/gif';
import { getBlob } from '../storage/db';
import { emitImagesLoaded, type ImageResolver } from './items';

type Entry = { kind: 'loading' } | { kind: 'static' } | { kind: 'animated'; frames: HTMLCanvasElement[]; delays: number[] };

const cache = new Map<string, Entry>();
const key = (docId: string, blobId: string) => `${docId}/${blobId}`;

/** Find out whether a photo is an animated GIF, decoding its frames if it is. */
export function ensureGif(docId: string, blobId: string): void {
  const k = key(docId, blobId);
  if (cache.has(k)) return;
  cache.set(k, { kind: 'loading' });
  void getBlob(docId, blobId)
    .then((b) => {
      const bytes = b && new Uint8Array(b.bytes);
      if (!bytes || (b.type !== 'image/gif' && !isGif(bytes))) return cache.set(k, { kind: 'static' });
      const gif = decodeGif(bytes);
      if (gif.frames.length < 2) return cache.set(k, { kind: 'static' });
      const frames = gif.frames.map((f) => {
        const c = document.createElement('canvas');
        c.width = gif.width;
        c.height = gif.height;
        c.getContext('2d')?.putImageData(new ImageData(f.rgba, gif.width, gif.height), 0, 0);
        return c;
      });
      cache.set(k, { kind: 'animated', frames, delays: gif.frames.map((f) => f.delay) });
      emitImagesLoaded();
    })
    .catch(() => cache.set(k, { kind: 'static' }));
}

/** Known not to be an animated GIF (an ordinary photo, a single-frame GIF, or unreadable). */
export function isStatic(docId: string, blobId: string): boolean {
  return cache.get(key(docId, blobId))?.kind === 'static';
}

export function isAnimated(docId: string, blobId: string): boolean {
  return cache.get(key(docId, blobId))?.kind === 'animated';
}

/** The frame index showing at time `t` (ms), or -1 for a photo that isn't an animated GIF. */
export function gifFrameIndex(docId: string, blobId: string, t: number): number {
  const e = cache.get(key(docId, blobId));
  return e?.kind === 'animated' ? frameAt(e.delays, t) : -1;
}

/** Images as they look at time `t`: animated GIFs at their current frame, everything else as `base` has it. */
export function animatedResolver(docId: string, base: ImageResolver, t: number): ImageResolver {
  return (blobId) => {
    const e = cache.get(key(docId, blobId));
    if (e?.kind === 'animated') return e.frames[frameAt(e.delays, t)];
    return base(blobId);
  };
}
