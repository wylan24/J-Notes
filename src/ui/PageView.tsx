import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { PAGE_H, PAGE_W, type EraseMode, type InputPoint, type Page, type PenStyle, type Stroke, type ToolKind } from '../core/model';
import { newId } from '../core/ids';
import { strokeHitsCircle, strokesInLasso, unionBounds, type Vec } from '../core/geometry';
import { detectLine, linePoints } from '../core/shapes';
import { removeStrokesOp, type DocOp } from '../core/ops';
import { replaceStrokesOps, splitStroke } from '../core/erase';
import type { DocumentStore } from '../core/store';
import { paintPage, paintStrokes } from '../render/page';
import { buildStrokePath } from '../render/stroke';

export interface ToolState {
  kind: ToolKind;
  color: string;
  width: number;
  penStyle: PenStyle;
  /** Fountain-pen tip sharpness, 0..1. */
  sharpness: number;
  /** Highlighter draws ruler-straight lines from the first point. */
  straight: boolean;
  /** Eraser radius in screen px, independent of zoom. */
  eraserPx: number;
  eraseMode: EraseMode;
  highlighterOnly: boolean;
}

export interface Selection {
  pageId: string;
  ids: string[];
}

export interface GestureState {
  touches: Map<number, Vec>;
  active: boolean;
}

interface Props {
  page: Page;
  zoom: number;
  store: DocumentStore;
  tool: ToolState;
  penOnly: boolean;
  gesture: MutableRefObject<GestureState>;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  selectionColors: string[];
}

const HOLD_MS = 550;
const LASER_FADE_MS = 700;
const LASER_COLOR = '#ff3b30';

interface LaserPoint extends Vec {
  t: number;
}

type Active =
  | {
      kind: 'ink';
      pointerId: number;
      stroke: Stroke;
      predicted: InputPoint[];
      straightened: boolean;
      holdTimer: ReturnType<typeof setTimeout> | null;
      anchor: Vec;
    }
  | {
      kind: 'erase';
      pointerId: number;
      /** Radius in page units, fixed for the whole gesture. */
      r: number;
      mode: EraseMode;
      canErase: (s: Stroke) => boolean;
      /** Whole-stroke mode: strokes to remove. */
      hits: Set<string>;
      /** Partial mode: original stroke id → its surviving pieces. */
      pieces: Map<string, Stroke[]>;
      cursor: Vec;
      last: Vec;
    }
  | { kind: 'lasso'; pointerId: number; poly: Vec[] }
  | { kind: 'laser'; pointerId: number; cursor: Vec };

/** A fading glowing trail; older segments are more transparent. */
function paintLaser(ctx: CanvasRenderingContext2D, trail: LaserPoint[], now: number, scale: number, head: Vec | null) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = LASER_COLOR;
  ctx.shadowColor = LASER_COLOR;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4 / scale;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    ctx.globalAlpha = Math.max(0, 1 - (now - b.t) / LASER_FADE_MS);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (head) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = LASER_COLOR;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 6 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.5 / scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function PageView({ page, zoom, store, tool, penOnly, gesture, selection, setSelection, selectionColors }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // Refs read by event handlers so they always see the latest props without re-binding.
  const pageRef = useRef(page);
  pageRef.current = page;
  const hidden = useRef<Set<string> | null>(null);
  const replaced = useRef<Map<string, Stroke[]> | null>(null);
  const laserTrail = useRef<LaserPoint[]>([]);
  const active = useRef<Active | null>(null);
  const clearLiveOnNextBase = useRef(false);
  const liveFrame = useRef(0);
  const [drag, setDragState] = useState<{ pointerId: number; sx: number; sy: number; dx: number; dy: number } | null>(null);
  // Mirror for the rAF painter, which must never see a stale closure.
  const dragRef = useRef<{ dx: number; dy: number; ids: string[] } | null>(null);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = zoom;
  const selected = selection?.pageId === page.id ? selection.ids : null;

  // --- Virtualisation: only pages near the viewport own a full-res canvas. ---
  useEffect(() => {
    const el = wrapRef.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const renderBase = () => {
    const canvas = baseRef.current;
    if (!canvas) return;
    paintPage(canvas, pageRef.current, scale, dpr, hidden.current ?? undefined, replaced.current ?? undefined);
    if (clearLiveOnNextBase.current) {
      clearLiveOnNextBase.current = false;
      clearLive();
    }
  };

  // Re-render committed layer on content change immediately, on zoom change debounced
  // (the CSS-stretched old bitmap covers the gap, like a tile cache would).
  const lastZoom = useRef(zoom);
  useLayoutEffect(() => {
    if (!visible) {
      const c = baseRef.current;
      if (c && c.width) {
        c.width = 0; // release GPU memory for off-screen pages
        c.height = 0;
      }
      return;
    }
    if (lastZoom.current !== zoom && baseRef.current?.width) {
      lastZoom.current = zoom;
      const t = setTimeout(renderBase, 120);
      return () => clearTimeout(t);
    }
    lastZoom.current = zoom;
    renderBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, visible, dpr]);

  // --- Live (wet-ink) layer -------------------------------------------------
  const liveCtx = () => {
    const c = liveRef.current!;
    const w = Math.round(PAGE_W * scale * dpr);
    const h = Math.round(PAGE_H * scale * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(w / PAGE_W, 0, 0, h / PAGE_H, 0, 0);
    return ctx;
  };

  const clearLive = () => {
    // A frame queued during the gesture must not repaint after we've cleared.
    if (liveFrame.current) cancelAnimationFrame(liveFrame.current);
    liveFrame.current = 0;
    const c = liveRef.current;
    if (c && c.width) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };

  const drawLive = () => {
    liveFrame.current = 0;
    const a = active.current;
    const d = dragRef.current;
    const ctx = liveCtx();
    if (d) {
      ctx.translate(d.dx, d.dy);
      const ids = new Set(d.ids);
      paintStrokes(ctx, pageRef.current.strokes.filter((s) => ids.has(s.id)));
      return;
    }
    const trail = laserTrail.current;
    if (trail.length || a?.kind === 'laser') {
      const now = performance.now();
      while (trail.length && now - trail[0].t > LASER_FADE_MS) trail.shift();
      paintLaser(ctx, trail, now, scale, a?.kind === 'laser' ? a.cursor : null);
      // Keep animating until the trail has faded and the pointer is up.
      if (trail.length || a?.kind === 'laser') liveFrame.current = requestAnimationFrame(drawLive);
    }
    if (!a) return;
    if (a.kind === 'ink') {
      const pts = a.straightened ? a.stroke.points : [...a.stroke.points, ...a.predicted];
      const path = buildStrokePath(pts, a.stroke, false);
      // Highlighter on the live layer is drawn opaque and blended via CSS multiply.
      ctx.fillStyle = a.stroke.color;
      if (a.stroke.tool === 'highlighter') ctx.globalAlpha = 0.38;
      ctx.fill(path);
    } else if (a.kind === 'erase') {
      ctx.beginPath();
      ctx.arc(a.cursor.x, a.cursor.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,120,120,0.12)';
      ctx.strokeStyle = 'rgba(80,80,80,0.6)';
      ctx.lineWidth = 1 / scale;
      ctx.fill();
      ctx.stroke();
    } else if (a.kind === 'lasso' && a.poly.length > 1) {
      ctx.beginPath();
      ctx.moveTo(a.poly[0].x, a.poly[0].y);
      for (const p of a.poly) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(64,120,220,0.06)';
      ctx.fill();
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.strokeStyle = '#3f7be0';
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
  };

  const scheduleLive = () => {
    if (!liveFrame.current) liveFrame.current = requestAnimationFrame(drawLive);
  };

  const setDrag = (next: typeof drag) => {
    dragRef.current = next && selected ? { dx: next.dx, dy: next.dy, ids: selected } : null;
    setDragState(next);
    if (next) scheduleLive();
  };

  // --- Input -----------------------------------------------------------------
  const toPage = (e: { clientX: number; clientY: number; pressure: number }, pointerType: string): InputPoint => {
    const r = liveRef.current!.getBoundingClientRect();
    const k = PAGE_W / r.width;
    return {
      x: (e.clientX - r.left) * k,
      y: (e.clientY - r.top) * k,
      // Mouse reports 0.5 while pressed; finger often 0 or 1 — both are synthesised later.
      p: pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5,
    };
  };

  const ignoreTouch = (e: React.PointerEvent) =>
    e.pointerType === 'touch' && (penOnly || gesture.current.active || gesture.current.touches.size > 1);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ignoreTouch(e) || active.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (selection) setSelection(null);
    const pt = toPage(e, e.pointerType);
    if (liveRef.current) liveRef.current.style.mixBlendMode = tool.kind === 'highlighter' ? 'multiply' : 'normal';

    if (tool.kind === 'pen' || tool.kind === 'highlighter') {
      // A straight highlighter starts already "straightened": the line follows the pointer until lift.
      const straight = tool.kind === 'highlighter' && tool.straight;
      const stroke: Stroke = {
        id: newId(),
        tool: tool.kind,
        color: tool.color,
        width: tool.width,
        points: straight ? linePoints(pt, pt) : [pt],
        simulatePressure: !straight && e.pointerType !== 'pen',
      };
      if (tool.kind === 'pen') {
        stroke.penStyle = tool.penStyle;
        if (tool.penStyle === 'fountain') stroke.sharpness = tool.sharpness;
      }
      active.current = { kind: 'ink', pointerId: e.pointerId, stroke, predicted: [], straightened: straight, holdTimer: null, anchor: pt };
      if (!straight) armHold();
    } else if (tool.kind === 'eraser') {
      const highlighterOnly = tool.highlighterOnly;
      active.current = {
        kind: 'erase',
        pointerId: e.pointerId,
        r: tool.eraserPx / scale,
        mode: tool.eraseMode,
        canErase: (s) => !highlighterOnly || s.tool === 'highlighter',
        hits: new Set(),
        pieces: new Map(),
        cursor: pt,
        last: pt,
      };
      eraseAt([pt]);
    } else if (tool.kind === 'laser') {
      active.current = { kind: 'laser', pointerId: e.pointerId, cursor: pt };
      laserTrail.current.push({ ...pt, t: performance.now() });
    } else {
      active.current = { kind: 'lasso', pointerId: e.pointerId, poly: [pt] };
    }
    scheduleLive();
  };

  const armHold = () => {
    const a = active.current;
    if (a?.kind !== 'ink') return;
    if (a.holdTimer) clearTimeout(a.holdTimer);
    a.holdTimer = setTimeout(() => {
      const cur = active.current;
      if (cur !== a || a.straightened) return;
      const line = detectLine(a.stroke.points);
      if (!line) return;
      a.straightened = true;
      a.stroke = { ...a.stroke, points: linePoints(line.a, line.b), simulatePressure: false };
      scheduleLive();
    }, HOLD_MS);
  };

  const eraseAt = (pts: Vec[]) => {
    const a = active.current;
    if (a?.kind !== 'erase') return;
    let changed = false;
    if (a.mode === 'stroke') {
      for (const s of pageRef.current.strokes) {
        if (a.hits.has(s.id) || !a.canErase(s)) continue;
        if (pts.some((p) => strokeHitsCircle(s, p.x, p.y, a.r))) {
          a.hits.add(s.id);
          changed = true;
        }
      }
      if (changed) hidden.current = a.hits;
    } else {
      // Cut along the segment from the last eraser position, so fast swipes leave no gaps.
      const path = [a.last, ...pts];
      for (const s of pageRef.current.strokes) {
        if (!a.canErase(s)) continue;
        let touched = false;
        const next = (a.pieces.get(s.id) ?? [s]).flatMap((piece) => {
          const cut = splitStroke(piece, path, a.r);
          if (cut) touched = true;
          return cut ?? [piece];
        });
        if (touched) {
          a.pieces.set(s.id, next);
          changed = true;
        }
      }
      if (changed) replaced.current = a.pieces;
    }
    a.last = pts[pts.length - 1];
    if (changed) renderBase();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    if (e.pointerType === 'touch' && gesture.current.active) {
      cancel(); // a second finger turned this into a pan/zoom
      return;
    }
    const native = e.nativeEvent;
    // Coalesced events recover the full sample rate (120–240 Hz on styluses)
    // that a 60 Hz pointermove would otherwise drop.
    const samples = native.getCoalescedEvents?.() ?? [];
    const pts = (samples.length ? samples : [native]).map((s) => toPage(s, e.pointerType));

    if (a.kind === 'ink') {
      const last = pts[pts.length - 1];
      if (a.straightened) {
        // After snapping, the end of the line follows the pen until lift.
        a.stroke = { ...a.stroke, points: linePoints(a.stroke.points[0], last) };
      } else {
        const prev = a.stroke.points;
        for (const p of pts) {
          const q = prev[prev.length - 1];
          if (p.x !== q.x || p.y !== q.y) prev.push(p);
        }
        // Predicted events extend the wet ink ahead of the pen to hide latency.
        const predicted = native.getPredictedEvents?.() ?? [];
        a.predicted = predicted.map((s) => toPage(s, e.pointerType));
        if (Math.hypot(last.x - a.anchor.x, last.y - a.anchor.y) * scale > 3) {
          a.anchor = last;
          armHold();
        }
      }
    } else if (a.kind === 'erase') {
      a.cursor = pts[pts.length - 1];
      eraseAt(pts);
    } else if (a.kind === 'laser') {
      const t = performance.now();
      a.cursor = pts[pts.length - 1];
      laserTrail.current.push(...pts.map((p) => ({ x: p.x, y: p.y, t })));
    } else {
      a.poly.push(...pts);
    }
    scheduleLive();
  };

  const finish = (commit: boolean) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    if (a.kind === 'ink') {
      if (a.holdTimer) clearTimeout(a.holdTimer);
      if (commit) {
        clearLiveOnNextBase.current = true;
        store.dispatch([{ type: 'strokes.added', pageId: page.id, strokes: [a.stroke] }]);
        return;
      }
    } else if (a.kind === 'erase') {
      hidden.current = null;
      replaced.current = null;
      let ops: DocOp[] = [];
      if (commit && a.mode === 'stroke') {
        const op = removeStrokesOp(pageRef.current, a.hits);
        if (op) ops = [op];
      } else if (commit) {
        ops = replaceStrokesOps(pageRef.current, a.pieces);
      }
      if (ops.length) store.dispatch(ops);
      else renderBase();
    } else if (a.kind === 'laser') {
      scheduleLive(); // let the trail fade out instead of clearing it
      return;
    } else if (a.kind === 'lasso' && commit) {
      const ids = strokesInLasso(pageRef.current.strokes, a.poly);
      setSelection(ids.length ? { pageId: page.id, ids } : null);
    }
    clearLive();
  };

  const cancel = () => finish(false);

  // --- Selection (lasso result) -------------------------------------------------
  const selStrokes = selected ? page.strokes.filter((s) => selected.includes(s.id)) : [];
  const selBounds = unionBounds(selStrokes);

  const onSelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    hidden.current = new Set(selected ?? []);
    renderBase();
    if (liveRef.current) liveRef.current.style.mixBlendMode = 'normal';
    setDrag({ pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };
  const onSelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag({ ...drag, dx: (e.clientX - drag.sx) / scale, dy: (e.clientY - drag.sy) / scale });
  };
  const onSelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    hidden.current = null;
    setDrag(null);
    if (selected && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5)) {
      clearLiveOnNextBase.current = true;
      store.dispatch([{ type: 'strokes.translated', pageId: page.id, ids: selected, dx: drag.dx, dy: drag.dy }]);
    } else {
      renderBase();
      clearLive();
    }
  };

  const deleteSelection = () => {
    const op = selected && removeStrokesOp(page, selected);
    if (op) store.dispatch([op]);
    setSelection(null);
  };
  const duplicateSelection = () => {
    const copies = selStrokes.map((s) => ({ ...s, id: newId(), points: s.points.map((p) => ({ ...p, x: p.x + 24, y: p.y + 24 })) }));
    store.dispatch([{ type: 'strokes.added', pageId: page.id, strokes: copies }]);
    setSelection({ pageId: page.id, ids: copies.map((s) => s.id) });
  };
  const recolorSelection = (color: string) => {
    if (!selStrokes.length) return;
    store.dispatch([
      {
        type: 'strokes.recolored',
        pageId: page.id,
        ids: selStrokes.map((s) => s.id),
        colors: selStrokes.map(() => color),
        previous: selStrokes.map((s) => s.color),
      },
    ]);
  };

  const cssW = PAGE_W * scale;
  const cssH = PAGE_H * scale;

  return (
    <div ref={wrapRef} className="page" style={{ width: cssW, height: cssH }}>
      <canvas ref={baseRef} className="page-layer" />
      <canvas
        ref={liveRef}
        className={`page-layer live tool-${tool.kind}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(true)}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => active.current?.pointerId === e.pointerId && finish(true)}
      />
      {selBounds && (
        <>
          <div
            className="selection-box"
            data-no-gesture
            style={{
              left: (selBounds.minX + (drag?.dx ?? 0)) * scale - 6,
              top: (selBounds.minY + (drag?.dy ?? 0)) * scale - 6,
              width: (selBounds.maxX - selBounds.minX) * scale + 12,
              height: (selBounds.maxY - selBounds.minY) * scale + 12,
            }}
            onPointerDown={onSelDown}
            onPointerMove={onSelMove}
            onPointerUp={onSelUp}
            onPointerCancel={onSelUp}
          />
          {!drag && (
            <div
              className="selection-menu"
              data-no-gesture
              style={{ left: selBounds.minX * scale, top: Math.max(4, selBounds.minY * scale - 52) }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button onClick={deleteSelection}>Delete</button>
              <button onClick={duplicateSelection}>Duplicate</button>
              <span className="divider" />
              {selectionColors.map((c) => (
                <button key={c} className="swatch-btn" aria-label={`Recolor ${c}`} onClick={() => recolorSelection(c)}>
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
