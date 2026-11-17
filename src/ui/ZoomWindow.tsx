import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pageSize, type InputPoint, type Page, type Stroke } from '../core/model';
import type { DocumentStore } from '../core/store';
import { advance, back, newLine, panelToPage, resizeTarget, shouldAdvance, ZOOM_ASPECT, type ZoomTarget } from '../core/zoomWindow';
import { paintRegion } from '../render/page';
import { imageResolver, onImagesLoaded } from '../render/items';
import { buildStrokePath, HIGHLIGHTER_ALPHA } from '../render/stroke';
import { Icon } from './icons';
import { newInkStroke, pressureOf, timeStamp } from './ink';
import type { ToolState } from './PageView';

/** Wait this long after a stroke ends in the advance zone before moving on, so a quick dot or cross doesn't jump. */
const ADVANCE_DELAY_MS = 450;

interface Props {
  store: DocumentStore;
  page: Page;
  target: ZoomTarget;
  setTarget: (t: ZoomTarget) => void;
  tool: ToolState;
  penOnly: boolean;
  onClose: () => void;
}

/**
 * A magnified view of the target box, docked under the pages. Pen and highlighter strokes
 * written here are mapped into the box on the page, and the box moves along the line.
 */
export function ZoomWindow({ store, page, target, setTarget, tool, penOnly, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const active = useRef<{ pointerId: number; stroke: Stroke; maxX: number } | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const canWrite = tool.kind === 'pen' || tool.kind === 'highlighter';

  // Fill the width, but never take more than ~30% of the window's height.
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const measure = () => {
      let w = Math.min(el.clientWidth - 24, 1000);
      let h = w / ZOOM_ASPECT;
      const maxH = window.innerHeight * 0.3;
      if (h > maxH) [h, w] = [maxH, maxH * ZOOM_ASPECT];
      setSize({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const paint = () => {
    const c = baseRef.current;
    if (!c || !size.w) return;
    paintRegion(c, page, target, size.w, size.h, dpr, { items: { images: imageResolver(store.doc.id) } });
    // The committed stroke is now in the base layer.
    if (!active.current) {
      const l = liveRef.current;
      l?.getContext('2d')?.clearRect(0, 0, l.width, l.height);
    }
  };
  useLayoutEffect(paint);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onImagesLoaded(paint), [page, target, size]);
  useEffect(() => () => void (advanceTimer.current && clearTimeout(advanceTimer.current)), []);

  const toPage = (e: { clientX: number; clientY: number; pressure: number }, pointerType: string): { pt: InputPoint; panelX: number } => {
    const r = liveRef.current!.getBoundingClientRect();
    const panel = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { pt: { ...panelToPage(panel, targetRef.current, r.width), p: pressureOf(e, pointerType), ...timeStamp() }, panelX: panel.x };
  };

  const drawLive = () => {
    const a = active.current;
    const c = liveRef.current;
    if (!a || !c) return;
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const k = w / target.w;
    ctx.setTransform(k, 0, 0, k, -target.x * k, -target.y * k);
    ctx.fillStyle = a.stroke.color;
    if (a.stroke.tool === 'highlighter') ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.fill(buildStrokePath(a.stroke.points, a.stroke, false));
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canWrite || active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'touch' && penOnly) return; // fingers don't write in stylus-only mode
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (advanceTimer.current) clearTimeout(advanceTimer.current); // still writing: stay put
    const { pt, panelX } = toPage(e, e.pointerType);
    active.current = { pointerId: e.pointerId, stroke: newInkStroke(tool, pt, e.pointerType), maxX: panelX };
    if (liveRef.current) liveRef.current.style.mixBlendMode = tool.kind === 'highlighter' ? 'multiply' : 'normal';
    drawLive();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const s of samples.length ? samples : [e.nativeEvent]) {
      const { pt, panelX } = toPage(s, e.pointerType);
      const q = a.stroke.points[a.stroke.points.length - 1];
      if (pt.x !== q.x || pt.y !== q.y) a.stroke.points.push(pt);
      a.maxX = Math.max(a.maxX, panelX);
    }
    drawLive();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    active.current = null;
    if (!commit) return paint();
    store.dispatch([{ type: 'strokes.added', pageId: targetRef.current.pageId, strokes: [a.stroke] }]);
    if (shouldAdvance(a.maxX, size.w)) {
      advanceTimer.current = setTimeout(() => setTarget(advance(targetRef.current, page.template, pageSize(page))), ADVANCE_DELAY_MS);
    }
  };

  const step = (w: number) => setTarget(resizeTarget(target, w, pageSize(page)));

  return (
    <div className="zoom-window" data-no-gesture>
      <div className="zoom-bar">
        <button className="icon-btn sm" aria-label="Move back along the line" title="Back" onClick={() => setTarget(back(target, pageSize(page)))}>
          <Icon name="back" />
        </button>
        <button className="icon-btn sm" aria-label="Move along the line" title="Forward" onClick={() => setTarget(advance(target, page.template, pageSize(page)))}>
          <Icon name="forward" />
        </button>
        <button className="icon-btn sm" aria-label="Next line" title="New line" onClick={() => setTarget(newLine(target, page.template, pageSize(page)))}>
          <Icon name="newline" />
        </button>
        <span className="divider" />
        {/* A smaller target box means more magnification. */}
        <button className="icon-btn sm" aria-label="Less magnification" title="Zoom out" onClick={() => step(target.w * 1.2)}>
          <Icon name="minus" />
        </button>
        <span className="zoom-label">{(size.w / target.w || 0).toFixed(1)}×</span>
        <button className="icon-btn sm" aria-label="More magnification" title="Zoom in" onClick={() => step(target.w / 1.2)}>
          <Icon name="plus" />
        </button>
        <span className="zoom-hint">{canWrite ? 'Write here; lifting in the shaded end moves along the line' : 'Choose the pen or highlighter to write here'}</span>
        <button className="icon-btn sm" aria-label="Close the zoom window" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="zoom-stage" ref={stageRef}>
        <div className="zoom-canvas" style={{ width: size.w, height: size.h }}>
          <canvas ref={baseRef} className="page-layer" />
          <div className="zoom-advance-zone" aria-hidden="true" />
          <canvas
            ref={liveRef}
            className={`page-layer live tool-${canWrite ? tool.kind : 'none'}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={(e) => onUp(e, true)}
            onPointerCancel={(e) => onUp(e, false)}
          />
        </div>
      </div>
    </div>
  );
}
