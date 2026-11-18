// A small GIF decoder: enough to play animated GIFs on the page (the canvas only ever draws a GIF's
// first frame). Pure: bytes in, composited RGBA frames out, so it runs in Node tests.

export interface GifFrame {
  /** How long the frame shows, in ms. */
  delay: number;
  /** The whole picture at this frame, width × height × RGBA. */
  rgba: Uint8ClampedArray;
}

export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];
}

/** Browsers treat very short delays (≤ 10 ms, often written as 0) as 100 ms; so do we. */
export const normaliseDelay = (centiseconds: number): number => (centiseconds <= 1 ? 100 : centiseconds * 10);

/** Decoding stops once this many pixels' worth of frames have been made, to keep memory in check. */
export const MAX_GIF_PIXELS = 60_000_000;

export function isGif(bytes: Uint8Array): boolean {
  return bytes.length > 6 && String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/) !== null;
}

/** LZW-decode one image's data into colour indices. Tolerates a missing end code and short data. */
export function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
  }
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let bits = 0, acc = 0, pos = 0, n = 0;
  while (n < pixelCount) {
    while (bits < codeSize) {
      if (pos >= data.length) return out;
      acc |= data[pos++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    let c: number;
    if (prev === -1) {
      if (code >= next) return out; // corrupt
      out[n++] = suffix[code];
      prev = code;
      continue;
    }
    if (code < next) {
      c = code;
      if (next < 4096) {
        prefix[next] = prev;
        suffix[next] = first[code];
        first[next] = first[prev];
        next++;
      }
    } else if (code === next && next < 4096) {
      // The KwKwK case: the new entry is prev + prev's first index.
      prefix[next] = prev;
      suffix[next] = first[prev];
      first[next] = first[prev];
      c = next++;
    } else {
      return out; // corrupt
    }
    let sp = 0;
    for (let k = c; k >= 0 && sp < stack.length; k = prefix[k]) stack[sp++] = suffix[k];
    while (sp > 0 && n < pixelCount) out[n++] = stack[--sp];
    prev = code;
    if (next === 1 << codeSize && codeSize < 12) codeSize++;
  }
  return out;
}

/** Row order of an interlaced image: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
export function interlacedRows(h: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

/** Decode a GIF into composited frames. Throws on something that isn't a GIF. */
export function decodeGif(bytes: Uint8Array, maxPixels = MAX_GIF_PIXELS): Gif {
  if (!isGif(bytes)) throw new Error('Not a GIF');
  let p = 6;
  const u8 = () => bytes[p++] ?? 0;
  const u16 = () => u8() | (u8() << 8);
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2; // background colour index, pixel aspect
  let globalTable: Uint8Array | null = null;
  if (packed & 0x80) {
    const n = 3 * (1 << ((packed & 7) + 1));
    globalTable = bytes.subarray(p, p + n);
    p += n;
  }
  const readSubBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let len = u8(); len && p < bytes.length; len = u8()) {
      parts.push(bytes.subarray(p, p + len));
      total += len;
      p += len;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of parts) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  };

  const frames: GifFrame[] = [];
  const canvas = new Uint8ClampedArray(width * height * 4);
  let delay = 0, disposal = 0, transparent = -1;
  let budget = maxPixels;

  while (p < bytes.length) {
    const block = u8();
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const data = readSubBlocks();
        const flags = data[0] ?? 0;
        disposal = (flags >> 2) & 7;
        delay = (data[1] ?? 0) | ((data[2] ?? 0) << 8);
        transparent = flags & 1 ? data[3] ?? -1 : -1;
      } else {
        readSubBlocks();
      }
      continue;
    }
    if (block !== 0x2c) break; // unknown: stop with what we have
    const left = u16(), top = u16(), w = u16(), h = u16();
    const flags = u8();
    let table = globalTable;
    if (flags & 0x80) {
      const n = 3 * (1 << ((flags & 7) + 1));
      table = bytes.subarray(p, p + n);
      p += n;
    }
    const minCodeSize = u8();
    const indices = lzwDecode(minCodeSize, readSubBlocks(), w * h);
    if (budget < width * height) break;
    budget -= width * height;

    const before = disposal === 3 ? canvas.slice() : null;
    const rows = flags & 0x40 ? interlacedRows(h) : null;
    for (let row = 0; row < h; row++) {
      const y = top + (rows ? rows[row] : row);
      if (y >= height) continue;
      for (let x = 0; x < w; x++) {
        const cx = left + x;
        if (cx >= width) continue;
        const idx = indices[row * w + x];
        if (idx === transparent || !table) continue;
        const o = (y * width + cx) * 4;
        canvas[o] = table[idx * 3] ?? 0;
        canvas[o + 1] = table[idx * 3 + 1] ?? 0;
        canvas[o + 2] = table[idx * 3 + 2] ?? 0;
        canvas[o + 3] = 255;
      }
    }
    frames.push({ delay: normaliseDelay(delay), rgba: canvas.slice() });

    // Prepare the canvas for the next frame.
    if (disposal === 2) {
      for (let y = top; y < Math.min(height, top + h); y++) canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4);
    } else if (disposal === 3 && before) {
      canvas.set(before);
    }
    delay = 0;
    disposal = 0;
    transparent = -1;
  }
  return { width, height, frames };
}

/** Which frame shows `t` ms into the loop. */
export function frameAt(delays: readonly number[], t: number): number {
  const total = delays.reduce((a, b) => a + b, 0);
  if (!total || delays.length < 2) return 0;
  let r = ((t % total) + total) % total;
  for (let i = 0; i < delays.length; i++) {
    if (r < delays[i]) return i;
    r -= delays[i];
  }
  return delays.length - 1;
}
