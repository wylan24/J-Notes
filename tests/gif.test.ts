import { describe, expect, it } from 'vitest';
import { decodeGif, frameAt, interlacedRows, isGif, normaliseDelay } from '../src/core/gif';
import { encodeGif } from './fixtures/gifEncode';

const PAL: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
const px = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
/** A busy pattern, so LZW codes grow past their starting size. */
const pattern = (w: number, h: number, seed: number) => Array.from({ length: w * h }, (_, i) => (i * 7 + seed * 3 + ((i * i) >> 3)) % 4);

describe('GIF decoding', () => {
  it('reads the classic 1×1 transparent GIF', () => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
    expect(isGif(bytes)).toBe(true);
    const gif = decodeGif(bytes);
    expect([gif.width, gif.height, gif.frames.length]).toEqual([1, 1, 1]);
    expect(px(gif.frames[0].rgba, 1, 0, 0)[3]).toBe(0);
  });

  it('decodes every pixel of busy frames exactly, through LZW code growth', () => {
    const w = 40, h = 30;
    const a = pattern(w, h, 1), b = pattern(w, h, 2);
    const gif = decodeGif(encodeGif(w, h, PAL, [{ indices: a, w, h, delayCs: 5 }, { indices: b, w, h, delayCs: 20 }]));
    expect(gif.frames.map((f) => f.delay)).toEqual([50, 200]);
    for (const [frame, idx] of [[gif.frames[0], a], [gif.frames[1], b]] as const) {
      for (let i = 0; i < w * h; i++) expect(px(frame.rgba, w, i % w, Math.floor(i / w))).toEqual([...PAL[idx[i]], 255]);
    }
  });

  it('reads interlaced frames in the right row order', () => {
    const w = 5, h = 11;
    const idx = Array.from({ length: w * h }, (_, i) => Math.floor(i / w) % 4);
    const gif = decodeGif(encodeGif(w, h, PAL, [{ indices: idx, w, h, interlace: true }]));
    for (let y = 0; y < h; y++) expect(px(gif.frames[0].rgba, w, 2, y)).toEqual([...PAL[y % 4], 255]);
    expect(interlacedRows(8)).toEqual([0, 4, 2, 6, 1, 3, 5, 7]);
  });

  it('composites sub-rect frames with transparency and each disposal method', () => {
    const full = Array(16).fill(0); // 4×4 red
    const dot = [1]; // 1×1 green
    const clearDot = [2, 3]; // 2×1: index 3 is transparent
    const gif = decodeGif(
      encodeGif(4, 4, PAL, [
        { indices: full, w: 4, h: 4 },
        { indices: dot, w: 1, h: 1, left: 1, top: 1, disposal: 2 }, // cleared afterwards
        { indices: clearDot, w: 2, h: 1, left: 2, top: 2, transparent: 3, disposal: 3 }, // undone afterwards
        { indices: [1], w: 1, h: 1, left: 0, top: 0 },
      ]),
    );
    const [f0, f1, f2, f3] = gif.frames.map((f) => f.rgba);
    expect(px(f0, 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(f1, 4, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(f2, 4, 1, 1)).toEqual([0, 0, 0, 0]); // disposal 2 cleared the dot
    expect(px(f2, 4, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(px(f2, 4, 3, 2)).toEqual([255, 0, 0, 255]); // transparent pixel shows what was there
    expect(px(f3, 4, 2, 2)).toEqual([255, 0, 0, 255]); // disposal 3 restored it
    expect(px(f3, 4, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('survives truncated data and stops at the pixel budget', () => {
    const bytes = encodeGif(8, 8, PAL, [{ indices: pattern(8, 8, 1), w: 8, h: 8 }, { indices: pattern(8, 8, 2), w: 8, h: 8 }]);
    expect(() => decodeGif(bytes.subarray(0, bytes.length - 20))).not.toThrow();
    expect(decodeGif(bytes, 64).frames).toHaveLength(1);
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))).toThrow();
  });
});

describe('GIF timing', () => {
  it('treats tiny delays as 100 ms, as browsers do', () => {
    expect([normaliseDelay(0), normaliseDelay(1), normaliseDelay(2), normaliseDelay(10)]).toEqual([100, 100, 20, 100]);
  });

  it('finds the frame showing at a time, looping', () => {
    expect([0, 49, 50, 249, 250, 299, 300].map((t) => frameAt([50, 200], t))).toEqual([0, 0, 1, 1, 0, 0, 1]);
    expect(frameAt([100], 5000)).toBe(0);
  });
});
