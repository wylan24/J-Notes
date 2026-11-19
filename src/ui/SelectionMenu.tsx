import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuAction {
  label: string;
  onClick: () => void;
  title?: string;
}

interface Props {
  /** The selection's box, in CSS px within the page. */
  anchor: { left: number; top: number; bottom: number };
  /** Space to leave above the selection (for the rotate handle). */
  clearance: number;
  /** Page width in CSS px; the menu stays within it. */
  pageW: number;
  /** Space to leave below the selection when the menu goes under it. */
  gapBelow?: number;
  /** Buttons always shown in the bar. */
  children: ReactNode;
  /** Less common actions, behind a More button. */
  more?: MenuAction[];
  /** Style controls (fonts, colours), on a row of their own. */
  styleRow?: ReactNode;
}

const MARGIN = 8;

/**
 * The bar of actions over a selection. It is measured after layout and kept inside the page and
 * the window, above the selection when there is room and below it otherwise; rare actions sit
 * behind More so the bar stays short.
 */
export function SelectionMenu({ anchor, clearance, pageW, gapBelow = 16, children, more = [], styleRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const place = () => {
    const el = ref.current;
    const pageEl = el?.offsetParent as HTMLElement | null;
    if (!el || !pageEl) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // The part of the page that is on screen, horizontally, in page CSS px.
    const r = pageEl.getBoundingClientRect();
    const lo = Math.max(0, -r.left + MARGIN);
    const hi = Math.min(pageW, window.innerWidth - r.left - MARGIN);
    const left = Math.max(lo, Math.min(anchor.left, hi - w));
    const above = anchor.top - clearance - h;
    const below = above < 4;
    const top = below ? anchor.bottom + gapBelow : above;
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top, below }));
  };

  useLayoutEffect(place);
  useEffect(() => {
    // Scrolling or resizing moves the page under the menu; keep it in view.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  });

  // The More list opens away from the selection, so it doesn't cover it, when there is room for that.
  const listUp = !!pos && !pos.below && pos.top >= more.length * 34 + 16;

  return (
    <div
      ref={ref}
      className="selection-menu"
      data-no-gesture
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.top, maxWidth: Math.max(160, pageW), visibility: pos ? undefined : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sel-row">
        {children}
        {more.length > 0 && (
          <button className="sel-more-btn" aria-label="More actions" aria-expanded={open} title="More" onClick={() => setOpen((o) => !o)}>
            ⋯
          </button>
        )}
      </div>
      {styleRow && <div className="sel-row sel-style">{styleRow}</div>}
      {open && (
        <div className={`sel-more ${listUp ? 'up' : ''}`} role="menu">
          {more.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              title={a.title}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
