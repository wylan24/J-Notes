import { forDarkPaper } from '../core/color';
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { InputPoint, Stroke } from '../core/model';
import { dabsByLevel, pencilAlpha, pencilDabs, type Dab } from '../core/pencil';
import { dashLengths, dotCentres, dotPolygon, dotSpacing, splitDashes } from '../core/dash';
import { stabiliseOptions, streamlinePoints } from '../core/stabilise';

export const HIGHLIGHTER_ALPHA = 0.38;

type InkStyle = Pick<Stroke, 'tool' | 'width' | 'simulatePressure' | 'penStyle' | 'sharpness' | 'shape' | 'dash' | 'stabilise'>;

const easeOut = (t: number) => Math.sin((t * Math.PI) / 2);

function freehandOptions(style: InkStyle, complete: boolean): StrokeOptions {
  if (style.tool === 'highlighter') {
    // Chisel-like: constant width, no pressure taper.
    return { size: style.width, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last: complete };
  }
  switch (style.penStyle) {
    case 'ball':
      // Near-constant width with only a hint of pressure.
      return { size: style.width * 0.9, thinning: 0.12, smoothing: 0.5, streamline: 0.4, simulatePressure: style.simulatePressure, last: complete };
    case 'brush':
      // Strong pressure response and tapered ends, like a soft brush tip.
      // Simulated (velocity) pressure with high thinning collapses to a hairline, so soften it.
      return {
        size: style.width * 1.8,
        thinning: style.simulatePressure ? 0.4 : 0.8,
        smoothing: 0.6,
        streamline: 0.4,
        simulatePressure: style.simulatePressure,
        easing: (t) => t * t * (3 - 2 * t),
        start: { taper: style.width * 6, easing: easeOut },
        end: complete ? { taper: style.width * 8, easing: easeOut } : undefined,
        last: complete,
      };
    default: {
      // Fountain pen. Sharpness 0.5 reproduces the pre-styles look (thinning 0.6).
      const sharp = style.sharpness ?? 0.5;
      return {
        size: style.width,
        thinning: 0.35 + 0.5 * sharp,
        smoothing: 0.55,
        streamline: 0.35,
        simulatePressure: style.simulatePressure,
        easing: easeOut,
        last: complete,
      };
    }
  }
}

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/** The filled outline of a stroke, as polygon points in page units. */
export function strokeOutline(points: InputPoint[], style: InkStyle, complete: boolean): number[][] {
  const input = points.map((p) => ({ x: p.x, y: p.y, pressure: p.p }));
  const options = freehandOptions(style, complete);
  // The stabilisation chosen when it was written; older strokes keep their pen's own amount.
  if (style.stabilise !== undefined) Object.assign(options, stabiliseOptions(style.stabilise));
  // Streamlining lags the pen to hide tremor; on a recognised shape it would round the corners off.
  if (style.shape) options.streamline = 0;
  return getStroke(input, options);
}

/**
 * The filled shapes a stroke is drawn as: one outline for a solid line, one per dash, or one per dot.
 * Dashes keep the pen's look (each is a short stroke with the same nib); dots are round.
 */
export function strokeOutlines(points: InputPoint[], style: InkStyle, complete: boolean): number[][][] {
  if (!style.dash || style.tool !== 'pen') return [strokeOutline(points, style, complete)];
  if (style.dash === 'dotted') return dotCentres(points, dotSpacing(style.width)).map((c) => dotPolygon(c, style.width * (0.45 + 0.15 * c.p)));
  const { on, off } = dashLengths(style.width);
  // Each dash is drawn from the pressure already recorded, rather than re-simulated over its short length.
  const piece = { ...style, simulatePressure: false };
  return splitDashes(points, on, off).map((seg) => strokeOutline(seg, piece, true));
}

export function buildStrokePath(points: InputPoint[], style: InkStyle, complete: boolean): Path2D {
  const outlines = strokeOutlines(points, style, complete);
  if (outlines.length === 1) return outlineToPath(outlines[0]);
  const path = new Path2D();
  for (const o of outlines) path.addPath(outlineToPath(o));
  return path;
}

/**
 * A committed stroke's outline as SVG path data, traced with the same curves as on screen,
 * for vector export. Empty for a stroke with no outline.
 */
export function strokeSvgPath(s: Stroke): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = '';
  for (const o of strokeOutlines(s.points, s, true)) {
    if (!o.length) continue;
    d += `M${f(o[0][0])} ${f(o[0][1])}`;
    for (let i = 1; i < o.length; i++) {
      const [x0, y0] = o[i - 1];
      const [x1, y1] = o[i];
      d += `Q${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`;
    }
    d += 'Z';
  }
  return d;
}

// Committed strokes are immutable, so their tessellated outline is cached by identity.
const pathCache = new WeakMap<Stroke, Path2D>();

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = buildStrokePath(s.points, s, true);
    pathCache.set(s, p);
  }
  return p;
}

/**
 * Paint a committed stroke. On dark paper (`dark`), dark ink is drawn lighter and the highlighter
 * lightens rather than darkens what is under it, so both stay visible; this is for the screen only.
 */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, path?: Path2D, alpha = 1, dark = false): void {
  const color = dark && s.tool !== 'highlighter' ? forDarkPaper(s.color) : s.color;
  if (s.tool === 'pen' && s.penStyle === 'pencil') {
    paintPencilLevels(ctx, pencilPaths(s), color, alpha);
    return;
  }
  path ??= strokePath(s);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA * alpha;
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
  }
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}

// --- Pencil --------------------------------------------------------------------------------

/**
 * Ink still being written (or a shape it snapped to), on the live layer: the same look as when it
 * is committed. The caller has set fill colour and highlighter alpha for ordinary ink.
 */
export function paintInk(ctx: CanvasRenderingContext2D, points: InputPoint[], style: InkStyle & Pick<Stroke, 'color'>, complete: boolean): void {
  if (style.tool === 'pen' && style.penStyle === 'pencil') {
    paintPencilLevels(ctx, levelPaths(pencilDabs(steadied(points, style), style.width, style.simulatePressure)), style.color, 1);
    return;
  }
  ctx.fill(buildStrokePath(points, style, complete));
}

function levelPaths(dabs: readonly Dab[]): Map<number, Path2D> {
  const out = new Map<number, Path2D>();
  for (const [level, list] of dabsByLevel(dabs)) {
    const p = new Path2D();
    for (const d of list) {
      p.moveTo(d.x + d.r, d.y);
      p.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    }
    out.set(level, p);
  }
  return out;
}

/** The pencil draws from its points directly, so it is steadied here rather than by the stroke engine. */
export function steadied(points: InputPoint[], style: Pick<Stroke, 'stabilise'>): InputPoint[] {
  return style.stabilise === undefined ? points : streamlinePoints(points, style.stabilise);
}

const pencilCache = new WeakMap<Stroke, Map<number, Path2D>>();
function pencilPaths(s: Stroke): Map<number, Path2D> {
  let p = pencilCache.get(s);
  if (!p) {
    p = levelPaths(pencilDabs(steadied(s.points, s), s.width, s.simulatePressure));
    pencilCache.set(s, p);
  }
  return p;
}

/** Device pixels per grain speck: fine enough to read as texture, coarse enough to see. */
const GRAIN_PX = 1.5;
const GRAIN_TILE = 64;
let grainTile: HTMLCanvasElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();

/** A tile of paper grain: mostly solid, with lighter specks and a few gaps. The same every time (seeded). */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = GRAIN_TILE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
    const r = rand();
    img.data[i * 4 + 3] = r < 0.12 ? 25 : Math.round(255 * (0.55 + 0.45 * rand()));
  }
  ctx.putImageData(img, 0, 0);
  return (grainTile = c);
}

/** The grain tile in an ink colour. */
function tintedGrain(color: string): HTMLCanvasElement {
  let t = tinted.get(color);
  if (!t) {
    t = document.createElement('canvas');
    t.width = t.height = GRAIN_TILE;
    const ctx = t.getContext('2d')!;
    ctx.drawImage(grain(), 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, GRAIN_TILE, GRAIN_TILE);
    if (tinted.size > 32) tinted.clear();
    tinted.set(color, t);
  }
  return t;
}

/** Fill each opacity level's dabs with grain in the ink colour. Grain is sized in device pixels, so it stays crisp at any zoom. */
function paintPencilLevels(ctx: CanvasRenderingContext2D, levels: Map<number, Path2D>, color: string, alpha: number): void {
  const pattern = ctx.createPattern(tintedGrain(color), 'repeat');
  if (!pattern) return;
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  pattern.setTransform(new DOMMatrix().scale(GRAIN_PX / k));
  ctx.save();
  ctx.fillStyle = pattern;
  for (const [level, path] of levels) {
    ctx.globalAlpha = alpha * pencilAlpha(level);
    ctx.fill(path);
  }
  ctx.restore();
}
