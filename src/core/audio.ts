// Linking ink to audio: strokes written during a recording carry its id and per-point times.
import type { InputPoint, Stroke } from './model';
import { strokeHitsCircle, type Vec } from './geometry';

/** Playback starts this long before the tapped ink, so the start of the sentence isn't clipped. */
export const SEEK_LEAD_MS = 1000;

export function strokeStartTime(s: Stroke): number | null {
  if (!s.rec) return null;
  let min = Infinity;
  for (const p of s.points) if (p.t !== undefined && p.t < min) min = p.t;
  return Number.isFinite(min) ? min : null;
}

/** 'ahead' for ink of the playing recording that it hasn't reached yet, 'played' for ink it has; null otherwise. */
export function playbackState(s: Stroke, recId: string, t: number): 'played' | 'ahead' | null {
  if (s.rec !== recId) return null;
  const start = strokeStartTime(s);
  if (start === null) return null;
  return start <= t ? 'played' : 'ahead';
}

export function seekTimeFor(s: Stroke): number {
  return Math.max(0, (strokeStartTime(s) ?? 0) - SEEK_LEAD_MS);
}

/** The topmost stroke under `pt` that was written during a recording. */
export function strokeAtForSeek(strokes: readonly Stroke[], pt: Vec, r: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (strokeStartTime(s) !== null && strokeHitsCircle(s, pt.x, pt.y, r)) return s;
  }
  return null;
}

/** Give a recognised shape's points the time its freehand stroke started, so it stays linked to the audio. */
export function stampShape(points: InputPoint[], t: number | undefined): InputPoint[] {
  return t === undefined ? points : points.map((p) => ({ ...p, t }));
}
