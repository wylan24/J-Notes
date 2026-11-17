import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PREFS, isDrawingTool, moveItem, toggleItem, visibleItems, type ToolbarItem, type ToolbarPrefs } from '../core/toolbarPrefs';
import { Icon } from './icons';

export const ITEM_INFO: Record<ToolbarItem, { label: string; icon: string }> = {
  pen: { label: 'Pen', icon: 'pen' },
  highlighter: { label: 'Highlighter', icon: 'highlighter' },
  shapes: { label: 'Shapes', icon: 'shapes' },
  text: { label: 'Text', icon: 'text' },
  sticky: { label: 'Sticky note', icon: 'sticky' },
  eraser: { label: 'Eraser', icon: 'eraser' },
  lasso: { label: 'Lasso', icon: 'lasso' },
  laser: { label: 'Laser pointer', icon: 'laser' },
  ruler: { label: 'Ruler', icon: 'ruler' },
  zoomWindow: { label: 'Zoom window', icon: 'zoomWindow' },
  photo: { label: 'Insert photo', icon: 'image' },
  audio: { label: 'Audio recording', icon: 'mic' },
  elements: { label: 'Elements', icon: 'elements' },
  timer: { label: 'Timer', icon: 'timer' },
};

/** A sheet to reorder toolbar buttons (drag, or the arrow buttons) and show or hide them. Changes apply live. */
export function ToolbarSettings({ prefs, onChange, onClose }: { prefs: ToolbarPrefs; onChange: (p: ToolbarPrefs) => void; onClose: () => void }) {
  const rows = useRef(new Map<ToolbarItem, HTMLLIElement>());
  const dragging = useRef<{ item: ToolbarItem; pointerId: number } | null>(null);
  const [dragItem, setDragItem] = useState<ToolbarItem | null>(null);
  const latest = useRef(prefs);
  latest.current = prefs;
  const shownDrawing = visibleItems(prefs).filter(isDrawingTool);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drag by the handle: the row moves to wherever the pointer is over the list.
  const onHandleDown = (item: ToolbarItem) => (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { item, pointerId: e.pointerId };
    setDragItem(item);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = dragging.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // The new index is how many of the other rows have their middle above the pointer.
    const order = latest.current.order;
    let to = 0;
    for (const it of order) {
      if (it === d.item) continue;
      const r = rows.current.get(it)?.getBoundingClientRect();
      if (r && e.clientY > r.top + r.height / 2) to++;
    }
    if (to !== order.indexOf(d.item)) onChange(moveItem(latest.current, d.item, to));
  };
  const onHandleUp = () => {
    dragging.current = null;
    setDragItem(null);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal toolbar-settings" role="dialog" aria-modal="true" aria-labelledby="tbs-title">
        <h2 id="tbs-title">Customise toolbar</h2>
        <p className="muted small">Drag to reorder, and switch off what you don't use. Keyboard shortcuts still work for hidden tools.</p>
        <ul className="tbs-list">
          {prefs.order.map((item, i) => {
            const shown = !prefs.hidden.includes(item);
            const locked = shown && isDrawingTool(item) && shownDrawing.length === 1;
            const { label, icon } = ITEM_INFO[item];
            return (
              <li
                key={item}
                ref={(el) => {
                  if (el) rows.current.set(item, el);
                  else rows.current.delete(item);
                }}
                className={dragItem === item ? 'dragging' : ''}
              >
                <span
                  className="tbs-handle"
                  aria-hidden="true"
                  title="Drag to reorder"
                  onPointerDown={onHandleDown(item)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                >
                  <Icon name="grip" />
                </span>
                <span className={`tbs-icon ${shown ? '' : 'off'}`}>
                  <Icon name={icon} />
                </span>
                <label className="tbs-label">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={shown}
                    disabled={locked}
                    title={locked ? 'Keep at least one drawing tool' : undefined}
                    onChange={() => onChange(toggleItem(prefs, item))}
                  />
                </label>
                <button className="icon-btn xs" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onChange(moveItem(prefs, item, i - 1))}>
                  <Icon name="up" />
                </button>
                <button className="icon-btn xs" aria-label={`Move ${label} down`} disabled={i === prefs.order.length - 1} onClick={() => onChange(moveItem(prefs, item, i + 1))}>
                  <Icon name="down" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => onChange(DEFAULT_PREFS)}>
            Reset
          </button>
          <button className="btn primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** The toolbar's "More" button: the buttons that didn't fit, in the same order, with their names. */
export function OverflowMenu({ items, render, active }: { items: ToolbarItem[]; render: (item: ToolbarItem) => ReactNode; active: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="overflow-wrap" ref={wrap}>
      <button className={`icon-btn ${active || open ? 'active' : ''}`} aria-label="More tools" aria-expanded={open} title="More tools" onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        // Picking a drawing tool closes the menu; panels (Elements, Timer) open inside it.
        <div className="overflow-panel" role="menu" onClick={(e) => (e.target as Element).closest('button[aria-pressed]') && setOpen(false)}>
          {items.map(render)}
        </div>
      )}
    </div>
  );
}

