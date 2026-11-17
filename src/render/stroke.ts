import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { InputPoint, Stroke } from '../core/model';

export const HIGHLIGHTER_ALPHA = 0.38;

type InkStyle = Pick<Stroke, 'tool' | 'width' | 'simulatePressure' | 'penStyle' | 'sharpness' | 'shape'>;

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

export function buildStrokePath(points: InputPoint[], style: InkStyle, complete: boolean): Path2D {
  const input = points.map((p) => ({ x: p.x, y: p.y, pressure: p.p }));
  const options = freehandOptions(style, complete);
  // Streamlining lags the pen to hide tremor; on a recognised shape it would round the corners off.
  if (style.shape) options.streamline = 0;
  return outlineToPath(getStroke(input, options));
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

export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, path: Path2D = strokePath(s), alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA * alpha;
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.fillStyle = s.color;
  ctx.fill(path);
  ctx.restore();
}
