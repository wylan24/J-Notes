// Shape and line items: their geometry, hit testing, and how recognised ink becomes one.
// Pure, so the renderer, PDF export, eraser and tests share one description of each outline.
import type { DashStyle, BoxPoint, LineItem, ShapeItem, ArrowEnds } from './model';
import type { Bounds, Vec } from './geometry';
import { distToSegmentSq, pointInPolygon } from './geometry';
import type { Shape } from './shapes';
import { newId } from './ids';

export interface ShapeStyle {
  color: string;
  width: number;
  dash: DashStyle;
  /** Fill for closed shapes; null for none. */
  fill?: string | null;
}

/** Corner radius a rectangle gets from Rounded corners, before it is limited by the box. */
export const ROUND_RADIUS = 16;

const dashField = (dash: DashStyle) => (dash === 'solid' ? {} : { dash });

/** An angle in (-π, π], or undefined when it is (nearly) zero, so an unturned item has no `rotation`. */
function rotationField(theta: number): { rotation?: number } {
  let t = theta % (2 * Math.PI);
  if (t > Math.PI) t -= 2 * Math.PI;
  if (t <= -Math.PI) t += 2 * Math.PI;
  return Math.abs(t) < 1e-6 ? {} : { rotation: t };
}

// --- Boxes and box points -----------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The axis-aligned box around points. */
export function boxAround(pts: readonly Vec[]): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A page point as a fraction of the box; 0 along a side the box has no extent in. */
export function toBoxPoint(b: Box, p: Vec): BoxPoint {
  return { x: b.w ? (p.x - b.x) / b.w : 0, y: b.h ? (p.y - b.y) / b.h : 0 };
}

export const fromBoxPoint = (b: Box, f: BoxPoint): Vec => ({ x: b.x + f.x * b.w, y: b.y + f.y * b.h });

// --- Lines ----------------------------------------------------------------------------------

/** A line's ends on the page. */
export function lineEnds(it: Pick<LineItem, 'x' | 'y' | 'w' | 'h' | 'ends'>): [Vec, Vec] {
  return [fromBoxPoint(it, it.ends[0]), fromBoxPoint(it, it.ends[1])];
}

/** The box and box-relative ends for a line from `a` to `b`. */
export function lineGeometry(a: Vec, b: Vec): Box & { ends: [BoxPoint, BoxPoint] } {
  const box = boxAround([a, b]);
  return { ...box, ends: [toBoxPoint(box, a), toBoxPoint(box, b)] };
}

export function newLine(a: Vec, b: Vec, style: ShapeStyle, arrow?: ArrowEnds): LineItem {
  return { id: newId(), kind: 'line', ...lineGeometry(a, b), color: style.color, width: style.width, ...dashField(style.dash), ...(arrow ? { arrow } : {}) };
}

/** The path a line is drawn along, start to end. */
export function linePath(it: LineItem): Vec[] {
  return lineEnds(it);
}

/** The open V of an arrowhead at `tip`, for a line arriving from `from`: [barb, tip, barb]. */
export function arrowHead(from: Vec, tip: Vec, width: number): Vec[] {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (len < 1e-6) return [];
  const ux = (from.x - tip.x) / len, uy = (from.y - tip.y) / len;
  const head = Math.min(36, Math.max(10, len * 0.22, width * 4));
  const barb = (sign: number): Vec => {
    const a = sign * (Math.PI / 7);
    const c = Math.cos(a), s = Math.sin(a);
    return { x: tip.x + (ux * c - uy * s) * head, y: tip.y + (ux * s + uy * c) * head };
  };
  return [barb(1), tip, barb(-1)];
}

/** Everything a line draws, as polylines: its path, then any arrowheads. */
export function lineStrokes(it: LineItem): Vec[][] {
  const path = linePath(it);
  const out = [path];
  const n = path.length;
  if (it.arrow === 'end' || it.arrow === 'both') out.push(arrowHead(path[n - 2], path[n - 1], it.width));
  if (it.arrow === 'start' || it.arrow === 'both') out.push(arrowHead(path[1], path[0], it.width));
  return out.filter((p) => p.length > 1);
}

/** Distance from `p` to a polyline. */
export function distToPolyline(p: Vec, pts: readonly Vec[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegmentSq(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  return Math.sqrt(best);
}

/** Whether `p` is on the line as drawn, allowing `slop` for a finger or a thin line. */
export function pointOnLine(it: LineItem, p: Vec, slop = 6): boolean {
  const reach = it.width / 2 + slop;
  return lineStrokes(it).some((s) => distToPolyline(p, s) <= reach);
}

/** The box around everything the line draws, including its ink width and arrowheads. */
export function lineBounds(it: LineItem): Bounds {
  const pts = lineStrokes(it).flat();
  const b = boxAround(pts);
  const pad = it.width / 2;
  return { minX: b.x - pad, minY: b.y - pad, maxX: b.x + b.w + pad, maxY: b.y + b.h + pad };
}

// --- Closed shapes --------------------------------------------------------------------------

/** A rectangle's corner radius as drawn: no more than half its shorter side. */
export const cornerRadius = (it: Pick<ShapeItem, 'w' | 'h' | 'radius'>): number => Math.max(0, Math.min(it.radius ?? 0, it.w / 2, it.h / 2));

/**
 * The closed outline of a shape in its unturned box, as a polygon whose last point repeats the
 * first. Rounded corners and ellipses are sampled finely enough to look smooth at any zoom.
 */
export function shapeOutline(it: ShapeItem): Vec[] {
  const { x, y, w, h } = it;
  let pts: Vec[];
  if (it.shape === 'ellipse') {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    const hh = ((rx - ry) / (rx + ry || 1)) ** 2;
    const perim = Math.PI * (rx + ry) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
    const n = Math.max(24, Math.ceil(perim / 5));
    pts = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
    });
  } else if (it.shape === 'polygon' && it.points && it.points.length >= 3) {
    pts = it.points.map((f) => fromBoxPoint(it, f));
  } else {
    const r = cornerRadius(it);
    if (r < 0.5) {
      pts = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    } else {
      // Clockwise from the top-left corner's arc; each corner is a quarter circle.
      const corners: [number, number, number][] = [
        [x + r, y + r, Math.PI],
        [x + w - r, y + r, -Math.PI / 2],
        [x + w - r, y + h - r, 0],
        [x + r, y + h - r, Math.PI / 2],
      ];
      const steps = Math.max(4, Math.ceil(r / 3));
      pts = corners.flatMap(([cx, cy, a0]) =>
        Array.from({ length: steps + 1 }, (_, i) => {
          const a = a0 + (i / steps) * (Math.PI / 2);
          return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
        }),
      );
    }
  }
  return [...pts, pts[0]];
}

/** Map points from a shape's unturned box to the page, turning them with the shape. */
export function turnWithShape(it: Pick<ShapeItem, 'x' | 'y' | 'w' | 'h' | 'rotation'>, pts: readonly Vec[]): Vec[] {
  const theta = it.rotation ?? 0;
  if (!theta) return [...pts];
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const c = Math.cos(theta), s = Math.sin(theta);
  return pts.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
}

/** Whether an eraser circle at `c` of radius `r` touches the shape or line as drawn (a filled shape anywhere inside). */
export function touchesCircle(it: ShapeItem | LineItem, c: Vec, r: number): boolean {
  const reach = r + it.width / 2;
  if (it.kind === 'line') return lineStrokes(it).some((s) => distToPolyline(c, s) <= reach);
  const outline = turnWithShape(it, shapeOutline(it));
  if (distToPolyline(c, outline) <= reach) return true;
  return !!it.fill && pointInPolygon(c.x, c.y, outline);
}

// --- From recognised ink ------------------------------------------------------------------

/**
 * The item a recognised shape becomes: lines and arrows are line items; rectangles keep their
 * turn as the item's rotation; triangles and other polygons keep their corners.
 */
export function itemFromShape(shape: Shape, style: ShapeStyle): ShapeItem | LineItem {
  const base = { id: newId(), color: style.color, width: style.width, ...dashField(style.dash) };
  const fill = style.fill ? { fill: style.fill } : {};
  switch (shape.kind) {
    case 'line':
      return { ...base, kind: 'line', ...lineGeometry(shape.a, shape.b) };
    case 'arrow':
      return { ...base, kind: 'line', ...lineGeometry(shape.tail, shape.tip), arrow: 'end' };
    case 'ellipse':
      return {
        ...base,
        kind: 'shape',
        shape: 'ellipse',
        x: shape.cx - shape.rx,
        y: shape.cy - shape.ry,
        w: 2 * shape.rx,
        h: 2 * shape.ry,
        ...fill,
        ...rotationField(shape.rotation),
      };
    case 'rectangle': {
      const [p0, p1, p2] = shape.points;
      const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const h = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const cx = shape.points.reduce((s, p) => s + p.x, 0) / 4;
      const cy = shape.points.reduce((s, p) => s + p.y, 0) / 4;
      return { ...base, kind: 'shape', shape: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, ...fill, ...rotationField(Math.atan2(p1.y - p0.y, p1.x - p0.x)) };
    }
    default: {
      const box = boxAround(shape.points);
      return { ...base, kind: 'shape', shape: 'polygon', ...box, points: shape.points.map((p) => toBoxPoint(box, p)), ...fill };
    }
  }
}
