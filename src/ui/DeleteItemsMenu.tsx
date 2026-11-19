import { useEffect, useRef, useState } from 'react';
import { CONTENT_KINDS, CONTENT_LABELS, countContent, type ContentKind } from '../core/contentKinds';
import type { Page } from '../core/model';
import { Icon } from './icons';

/** "Delete specific items": clear one kind of content from the current page, or all of it, as one undo step. */
export function DeleteItemsMenu({ page, onDelete }: { page: Page | undefined; onDelete: (kind: ContentKind | 'all') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const counts = page ? countContent(page) : null;
  const total = counts ? CONTENT_KINDS.reduce((n, k) => n + counts[k], 0) : 0;
  const pick = (kind: ContentKind | 'all') => {
    setOpen(false);
    onDelete(kind);
  };
  return (
    <div className="menu delete-items" ref={ref}>
      <button className="btn sm ghost" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} disabled={!total}>
        <Icon name="trash" /> Delete items…
      </button>
      {open && counts && (
        <div className="menu-pop" role="menu" aria-label="Delete from this page">
          <span className="menu-heading">Delete from this page</span>
          {CONTENT_KINDS.filter((k) => counts[k]).map((k) => (
            <button key={k} role="menuitem" onClick={() => pick(k)}>
              {CONTENT_LABELS[k]} <span className="muted">({counts[k]})</span>
            </button>
          ))}
          <hr />
          <button role="menuitem" className="danger-text" onClick={() => pick('all')}>
            Everything on this page <span className="muted">({total})</span>
          </button>
        </div>
      )}
    </div>
  );
}
