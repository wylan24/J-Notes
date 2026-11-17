import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pageSize, type Page } from '../core/model';
import { dropTarget, stackLayout, visibleRange } from '../core/pages';
import { paintPage } from '../render/page';
import { imageResolver, onImagesLoaded } from '../render/items';
import { Icon } from './icons';
import { PageMenuItems, type PageActionHandlers } from './PageActions';

/** Thumbnail width and spacing, in CSS px. */
const THUMB_W = 112;
const LABEL_H = 22;
const GAP = 12;
const PAD = 14;
/** Thumbnails within this distance of the visible band are kept mounted, so fast scrolls don't flash. */
const OVERSCAN = 600;
/** Touch and pen start a drag after a press this long; moving sooner scrolls instead. */
const LONG_PRESS_MS = 350;
const SLOP = 8;
/** Auto-scroll while dragging near the top or bottom edge. */
const EDGE = 48;
const EDGE_SPEED = 14;

// --- Thumbnail cache ------------------------------------------------------------------------
// Pages are immutable, so a page object's thumbnail never goes stale; keyed by object, a page
// that changes simply misses. Bounded so a long notebook doesn't hold hundreds of canvases.
const MAX_CACHED = 120;
const cache = new Map<Page, HTMLCanvasElement>();

function thumbnail(page: Page, docId: string, dpr: number): HTMLCanvasElement {
  const hit = cache.get(page);
  if (hit) {
    cache.delete(page); // refresh its place in the LRU order
    cache.set(page, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  paintPage(c, page, THUMB_W / pageSize(page).w, dpr, { items: { images: imageResolver(docId) } });
  cache.set(page, c);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return c;
}

function Thumb({ page, docId, version }: { page: Page; docId: string; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const own = ref.current;
    if (!own) return;
    const src = thumbnail(page, docId, Math.min(window.devicePixelRatio || 1, 2));
    own.width = src.width;
    own.height = src.height;
    own.getContext('2d')?.drawImage(src, 0, 0);
  }, [page, docId, version]);
  return <canvas ref={ref} className="thumb-canvas" />;
}

interface Drag {
  pointerId: number;
  pageId: string;
  from: number;
  slot: number;
  to: number;
  clientY: number;
}

interface Press {
  pointerId: number;
  index: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  mouse: boolean;
}

export function PageSidebar({
  pages,
  docId,
  currentPage,
  onJump,
  onMove,
  actions,
}: {
  pages: readonly Page[];
  docId: string;
  currentPage: number;
  onJump: (index: number) => void;
  onMove: (pageId: string, to: number) => void;
  actions: (index: number) => PageActionHandlers;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const [version, setVersion] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const press = useRef<Press | null>(null);
  /** The open page menu: which page, and where (viewport px) its button sits. */
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  const heights = useMemo(() => pages.map((p) => (THUMB_W * pageSize(p).h) / pageSize(p).w + LABEL_H), [pages]);
  const { tops, height } = useMemo(() => stackLayout(heights, GAP), [heights]);
  const [start, end] = visibleRange(tops, heights, view.top - PAD - OVERSCAN, view.top + view.height + OVERSCAN);

  // Images finish loading after first paint: drop cached thumbnails and repaint.
  useEffect(
    () =>
      onImagesLoaded(() => {
        cache.clear();
        setVersion((v) => v + 1);
      }),
    [],
  );

  // Track the viewport for virtualisation.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the current page's thumbnail in view as the notebook scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragRef.current || tops[currentPage] === undefined) return;
    const top = PAD + tops[currentPage];
    const bottom = top + heights[currentPage];
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Close the page menu on any press outside it.
  useEffect(() => {
    if (menu === null) return;
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.thumb-menu, .thumb-more') && setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  // While dragging with touch, stop the browser from scrolling the list instead (needs a non-passive listener).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => dragRef.current && e.preventDefault();
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  /** Recompute the drop slot for a pointer at `clientY`. */
  const retarget = (d: Drag, clientY: number): Drag => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - PAD;
    const { slot, to } = dropTarget(tops, heights, y, d.from);
    return { ...d, slot, to, clientY };
  };

  // Auto-scroll near the edges while dragging.
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const step = () => {
      const el = scrollRef.current;
      const d = dragRef.current;
      if (!el || !d) return;
      const r = el.getBoundingClientRect();
      const dv = d.clientY < r.top + EDGE ? -EDGE_SPEED : d.clientY > r.bottom - EDGE ? EDGE_SPEED : 0;
      if (dv) {
        el.scrollTop += dv;
        setDrag(retarget(d, d.clientY));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag, tops, heights]);

  const startDrag = (p: Press, clientY: number) => {
    const page = pages[p.index];
    if (!page) return;
    setMenu(null);
    // Capture on the list, not the thumbnail: the thumbnail may unmount as the list scrolls.
    scrollRef.current?.setPointerCapture(p.pointerId);
    setDrag(retarget({ pointerId: p.pointerId, pageId: page.id, from: p.index, slot: p.index, to: p.index, clientY }, clientY));
  };

  const clearPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const thumb = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!thumb || (e.target as HTMLElement).closest('.thumb-more, .thumb-menu')) return;
    const index = Number(thumb.dataset.index);
    clearPress();
    const p: Press = { pointerId: e.pointerId, index, x: e.clientX, y: e.clientY, timer: null, mouse: e.pointerType === 'mouse' };
    if (!p.mouse) p.timer = setTimeout(() => press.current === p && startDrag(p, p.y), LONG_PRESS_MS);
    press.current = p;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag) {
      if (e.pointerId === drag.pointerId) setDrag(retarget(drag, e.clientY));
      return;
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
    if (!moved) return;
    // Mouse: dragging starts on movement. Touch and pen: moving before the long press means scrolling.
    if (p.mouse) {
      clearPress();
      startDrag(p, e.clientY);
    } else clearPress();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag && e.pointerId === drag.pointerId) {
      if (drag.to !== drag.from) onMove(drag.pageId, drag.to);
      setDrag(null);
      return;
    }
    const p = press.current;
    if (p && p.pointerId === e.pointerId) {
      clearPress();
      onJump(p.index);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag && e.pointerId === drag.pointerId) setDrag(null);
    if (press.current?.pointerId === e.pointerId) clearPress();
  };

  const slotY = (slot: number) => PAD + (slot < tops.length ? tops[slot] - GAP / 2 : height + GAP / 2);

  return (
    <aside className="sidebar" data-no-gesture aria-label="Pages">
      <div
        ref={scrollRef}
        className={`sidebar-scroll ${drag ? 'dragging' : ''}`}
        onScroll={(e) => {
          setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
          if (menu) setMenu(null); // the menu is placed in the viewport, so it would drift
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="sidebar-content" style={{ height: height + PAD * 2 }}>
          {pages.slice(start, end).map((page, k) => {
            const i = start + k;
            return (
              <div
                key={page.id}
                data-index={i}
                className={`thumb ${i === currentPage ? 'current' : ''} ${drag?.pageId === page.id ? 'lifted' : ''}`}
                style={{ top: PAD + tops[i], height: heights[i], left: PAD, width: THUMB_W }}
                aria-label={`Page ${i + 1}`}
                aria-current={i === currentPage ? 'page' : undefined}
              >
                <Thumb page={page} docId={docId} version={version} />
                <div className="thumb-label">
                  <span>{i + 1}</span>
                  <button
                    className="thumb-more"
                    aria-label={`Page ${i + 1} actions`}
                    title="Page actions"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu(menu?.index === i ? null : { index: i, x: r.left, y: r.bottom });
                    }}
                  >
                    <Icon name="more" />
                  </button>
                </div>
              </div>
            );
          })}
          {drag && drag.slot !== drag.from && drag.slot !== drag.from + 1 && <div className="drop-line" style={{ top: slotY(drag.slot) - 1.5 }} />}
        </div>
      </div>
      {menu && pages[menu.index] && (
        // Fixed, outside the scrolling list, so the sidebar's edge doesn't clip it. Kept on screen near the bottom.
        <div
          className="menu-pop thumb-menu"
          style={{ left: Math.max(8, menu.x - 12), top: Math.min(menu.y + 4, window.innerHeight - 300) }}
          onClick={(e) => (e.target as HTMLElement).closest('button') && setMenu(null)}
        >
          <PageMenuItems actions={actions(menu.index)} showRemove />
        </div>
      )}
    </aside>
  );
}
