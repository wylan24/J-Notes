import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SavedElement } from '../core/elements';
import { deleteElement, listElements, renameElement } from '../storage/db';
import { Icon } from './icons';

/** Movement (px) before a press on a tile becomes a drag rather than a tap. */
const DRAG_SLOP = 6;

interface Props {
  /** Bumped by the editor after saving, so an open panel shows the new element. */
  version: number;
  /** Place an element: at a drop point, or (no point) in the middle of the visible page. Resolves false if dropped off the pages. */
  onPlace: (el: SavedElement, clientX?: number, clientY?: number) => Promise<boolean>;
}

/** Toolbar button and panel for the elements library. Tap a tile to add it, or drag it onto a page. */
export function ElementsButton({ version, onPlace }: Props) {
  const [open, setOpen] = useState(false);
  // The panel hangs left from the button; if that would run off the left edge, it hangs right instead.
  // Measured before paint, so it never flashes on the wrong side.
  const [alignLeft, setAlignLeft] = useState(false);
  useLayoutEffect(() => {
    if (!open) return setAlignLeft(false);
    const panel = wrap.current?.querySelector('.elements-panel');
    if (panel && panel.getBoundingClientRect().left < 8) setAlignLeft(true);
  }, [open]);
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
    <div className={`elements-wrap ${alignLeft ? 'align-left' : ''}`} ref={wrap}>
      <button className={`icon-btn ${open ? 'active' : ''}`} aria-label="Elements" aria-expanded={open} title="Elements: saved selections" onClick={() => setOpen(!open)}>
        <Icon name="elements" />
      </button>
      {open && <ElementsPanel version={version} onPlace={async (el, x, y) => (await onPlace(el, x, y)) && (setOpen(false), true)} />}
    </div>
  );
}

function ElementsPanel({ version, onPlace }: Props) {
  const [elements, setElements] = useState<SavedElement[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ el: SavedElement; x: number; y: number } | null>(null);
  const press = useRef<{ el: SavedElement; pointerId: number; sx: number; sy: number; dragging: boolean } | null>(null);

  const refresh = () =>
    void listElements()
      .then(setElements)
      .catch(() => setElements([]));
  useEffect(refresh, [version]);

  // Pointer-based drag, so stylus and touch work as well as the mouse.
  const onTileDown = (el: SavedElement) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { el, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, dragging: false };
  };
  const onTileMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_SLOP) return;
    p.dragging = true;
    setGhost({ el: p.el, x: e.clientX, y: e.clientY });
  };
  const onTileUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    setGhost(null);
    if (p.dragging) void onPlace(p.el, e.clientX, e.clientY);
    else void onPlace(p.el);
  };
  const onTileCancel = () => {
    press.current = null;
    setGhost(null);
  };

  return (
    <div className="elements-panel" role="dialog" aria-label="Elements" data-no-gesture>
      <div className="elements-head">
        <strong>Elements</strong>
        <span className="muted small">Tap to add, or drag onto a page</span>
      </div>
      {elements?.length === 0 && (
        <p className="muted elements-empty">
          Select ink, text or photos with the lasso, then choose <strong>Save as element</strong> to reuse them in any notebook.
        </p>
      )}
      <ul className="elements-grid">
        {elements?.map((el) => (
          <li key={el.id}>
            <button
              className="element-tile"
              aria-label={`Add ${el.name}`}
              onPointerDown={onTileDown(el)}
              onPointerMove={onTileMove}
              onPointerUp={onTileUp}
              onPointerCancel={onTileCancel}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), void onPlace(el))}
            >
              <img src={el.thumbnail} alt="" draggable={false} />
            </button>
            <div className="element-meta">
              {renaming === el.id ? (
                <input
                  className="element-rename"
                  defaultValue={el.name}
                  aria-label="Element name"
                  autoFocus
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    setRenaming(null);
                    if (name && name !== el.name) void renameElement(el.id, name).then(refresh);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <button className="element-name" title="Rename" onClick={() => setRenaming(el.id)}>
                  {el.name}
                </button>
              )}
              <button
                className="icon-btn xs"
                aria-label={`Delete ${el.name}`}
                title="Delete"
                onClick={() => {
                  if (confirm(`Delete the element “${el.name}”? Copies already on pages stay.`)) void deleteElement(el.id).then(refresh);
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {ghost && <img className="element-ghost" src={ghost.el.thumbnail} alt="" style={{ left: ghost.x, top: ghost.y }} />}
    </div>
  );
}
