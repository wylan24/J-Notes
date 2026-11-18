// A minimal GIF encoder for tests: real LZW with code-size growth, sub-rect frames, disposal,
// transparency and interlacing, so the decoder is exercised the way real files exercise it.

export interface TestFrame {
  /** Colour indices, w × h, in display row order. */
  indices: number[];
  left?: number;
  top?: number;
  w: number;
  h: number;
  delayCs?: number;
  disposal?: number;
  transparent?: number;
  interlace?: boolean;
}

export function lzwEncode(minCodeSize: number, indices: number[]): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map<string, number>();
  const out: number[] = [];
  let acc = 0, bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };
  const codeOf = (s: string) => (s.includes(',') ? dict.get(s)! : Number(s));
  emit(clear);
  let w = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const wk = `${w},${indices[i]}`;
    if (dict.has(wk)) {
      w = wk;
      continue;
    }
    emit(codeOf(w));
    if (next >= 4096) throw new Error('test encoder: dictionary full');
    dict.set(wk, next++);
    if (next > 1 << codeSize && codeSize < 12) codeSize++;
    w = String(indices[i]);
  }
  emit(codeOf(w));
  emit(eoi);
  if (bits > 0) out.push(acc & 0xff);
  return Uint8Array.from(out);
}

export function encodeGif(width: number, height: number, palette: [number, number, number][], frames: TestFrame[]): Uint8Array {
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  const sizeBits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  bytes.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
  u16(width);
  u16(height);
  bytes.push(0x80 | (sizeBits - 1), 0, 0);
  for (let i = 0; i < 1 << sizeBits; i++) bytes.push(...(palette[i] ?? [0, 0, 0]));
  for (const f of frames) {
    const t = f.transparent ?? -1;
    bytes.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (t >= 0 ? 1 : 0));
    u16(f.delayCs ?? 10);
    bytes.push(t >= 0 ? t : 0, 0);
    bytes.push(0x2c);
    u16(f.left ?? 0);
    u16(f.top ?? 0);
    u16(f.w);
    u16(f.h);
    bytes.push(f.interlace ? 0x40 : 0);
    // Interlaced data is stored in interlace row order.
    let data = f.indices;
    if (f.interlace) {
      const order: number[] = [];
      for (const [s, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < f.h; y += step) order.push(y);
      data = order.flatMap((y) => f.indices.slice(y * f.w, (y + 1) * f.w));
    }
    const min = Math.max(2, sizeBits);
    bytes.push(min);
    const lzw = lzwEncode(min, data);
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.subarray(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
