import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Vec } from '../core/geometry';
import { pageSize } from '../core/model';
import { fitPage, INITIAL_AUDIENCE, presentChannel, reduceAudience, shownPage, type PresentMessage } from '../core/presentation';
import { paintLaser, pruneTrail, type LaserPoint } from '../render/laser';
import { imageResolver, onImagesLoaded } from '../render/items';
import { paintPage } from '../render/page';
import { pdfResolver } from '../render/pdf';

/** How often the audience asks for the notebook until the presenter answers. */
const HELLO_EVERY_MS = 500;

/**
 * The audience window: the presenter's current page, fitted to the window, with no chrome, and
 * their laser pointer. Everything shown arrives over the channel from the editor.
 */
export function Presentation({ docId }: { docId: string }) {
  const [state, dispatch] = useReducer(reduceAudience, INITIAL_AUDIENCE);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [imagesVersion, setImagesVersion] = useState(0);
  const pageCanvas = useRef<HTMLCanvasElement>(null);
  const laserCanvas = useRef<HTMLCanvasElement>(null);
  const trail = useRef<LaserPoint[]>([]);
  const head = useRef<Vec | null>(null);
  const frame = useRef(0);
  const page = shownPage(state);
  const pageRef = useRef(page);
  pageRef.current = page;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = page ? pageSize(page) : { w: 1, h: 1 };
  const fit = fitPage(size, view);

  // Draw the laser trail until it has faded.
  const drawLaser = () => {
    frame.current = 0;
    const c = laserCanvas.current;
    const p = pageRef.current;
    if (!c || !p) return;
    const s = pageSize(p);
    const f = fitPage(s, { w: window.innerWidth, h: window.innerHeight });
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const now = performance.now();
    pruneTrail(trail.current, now);
    ctx.setTransform(f.scale * dpr, 0, 0, f.scale * dpr, 0, 0);
    paintLaser(ctx, trail.current, now, f.scale, head.current);
    if (trail.current.length || head.current) frame.current = requestAnimationFrame(drawLaser);
  };

  useEffect(() => {
    const ch = new BroadcastChannel(presentChannel(docId));
    let synced = false;
    ch.onmessage = (e: MessageEvent<PresentMessage>) => {
      const msg = e.data;
      if (msg.type === 'sync') synced = true;
      if (msg.type === 'laser') {
        if (msg.pageId !== pageRef.current?.id) return;
        const t = performance.now();
        trail.current.push(...msg.points.map((p) => ({ ...p, t })));
        head.current = msg.head;
        if (!frame.current) frame.current = requestAnimationFrame(drawLaser);
        return;
      }
      if (msg.type === 'page') {
        trail.current = [];
        head.current = null;
      }
      dispatch(msg);
    };
    const hello = () => !synced && ch.postMessage({ type: 'hello' } satisfies PresentMessage);
    hello();
    const timer = setInterval(hello, HELLO_EVERY_MS);
    const bye = () => ch.postMessage({ type: 'bye' } satisfies PresentMessage);
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', bye);
      ch.close();
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => onImagesLoaded(() => setImagesVersion((v) => v + 1)), []);
  useEffect(() => {
    document.title = state.title ? `${state.title} · Presenting` : 'J Notes presentation';
  }, [state.title]);

  // Paint the page whenever it, the window, or its images change.
  useLayoutEffect(() => {
    const c = pageCanvas.current;
    if (!c || !page) return;
    paintPage(c, page, fit.scale, dpr, { items: { images: imageResolver(docId) }, pdf: pdfResolver(docId) });
    const l = laserCanvas.current;
    if (l) {
      l.width = c.width;
      l.height = c.height;
    }
  }, [page, fit.scale, dpr, docId, imagesVersion]);

  const cssW = size.w * fit.scale;
  const cssH = size.h * fit.scale;
  return (
    <div className="presentation">
      {!state.doc ? (
        <p className="presentation-msg">Waiting for the presenter…</p>
      ) : state.ended ? (
        <p className="presentation-msg">The presentation has ended. You can close this window.</p>
      ) : (
        <div className="presentation-page" style={{ left: fit.x, top: fit.y, width: cssW, height: cssH }}>
          <canvas ref={pageCanvas} style={{ width: cssW, height: cssH }} />
          <canvas ref={laserCanvas} style={{ width: cssW, height: cssH }} className="presentation-laser" />
        </div>
      )}
    </div>
  );
}
