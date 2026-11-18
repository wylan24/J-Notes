// Stabilisation: how much a line is steadied against hand tremor, 0 (raw) to 1 (very smooth, lags the
// pen). It maps to the stroke engine's streamline (how far the line trails the pen) and smoothing.

/** Roughly the steadiness pens had before the setting existed. */
export const DEFAULT_STABILISE = 0.3;

export function normaliseStabilise(v: unknown, fallback = DEFAULT_STABILISE): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/** Stroke-engine settings for a stabilisation amount. */
export function stabiliseOptions(s: number): { streamline: number; smoothing: number } {
  const k = normaliseStabilise(s);
  return { streamline: 0.1 + 0.8 * k, smoothing: 0.35 + 0.55 * k };
}

/**
 * Steady raw points the same way, for ink drawn straight from its points (the pencil): each point
 * moves only part of the way from the previous steadied point towards where the pen actually was.
 * The last point is kept, so the line still ends under the pen.
 */
export function streamlinePoints<T extends { x: number; y: number }>(points: readonly T[], s: number): T[] {
  const { streamline } = stabiliseOptions(s);
  if (points.length < 3 || streamline <= 0.1) return [...points];
  const keep = 1 - streamline;
  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[i - 1];
    const p = points[i];
    out.push({ ...p, x: prev.x + (p.x - prev.x) * keep, y: prev.y + (p.y - prev.y) * keep });
  }
  out.push(points[points.length - 1]);
  return out;
}
