import type { InputPoint } from './model';
import { distToSegmentSq, pointsLength } from './geometry';

/**
 * "Hold to straighten": if a stroke is roughly straight when the user pauses
 * at its end, return its endpoints so the caller can snap it to a line.
 */
export function detectLine(points: InputPoint[]): { a: InputPoint; b: InputPoint } | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < 24) return null;
  if (pointsLength(points) / chord > 1.2) return null; // too wiggly / doubles back
  let maxDevSq = 0;
  for (const p of points) maxDevSq = Math.max(maxDevSq, distToSegmentSq(p.x, p.y, a.x, a.y, b.x, b.y));
  return Math.sqrt(maxDevSq) / chord < 0.08 ? { a, b } : null;
}

/** Evenly spaced constant-pressure points along a line (renders with uniform width). */
export function linePoints(a: { x: number; y: number }, b: { x: number; y: number }): InputPoint[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
    p: 0.5,
  }));
}
