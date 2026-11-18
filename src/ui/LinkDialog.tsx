import { useState } from 'react';
import { normaliseUrl } from '../core/links';
import type { LinkTarget, Page } from '../core/model';

/** Make or edit a link: to a page of this notebook, or to a web address. */
export function LinkDialog({
  pages,
  initial,
  currentPage,
  onCancel,
  onSave,
  onRemove,
}: {
  pages: readonly Page[];
  /** The link being edited; absent when making a new one. */
  initial?: LinkTarget;
  currentPage: number;
  onCancel: () => void;
  onSave: (target: LinkTarget) => void;
  /** Present when editing: remove the link. */
  onRemove?: () => void;
}) {
  const [kind, setKind] = useState<LinkTarget['kind']>(initial?.kind ?? 'page');
  const initialIndex = initial?.kind === 'page' ? pages.findIndex((p) => p.id === initial.pageId) : -1;
  const [pageIndex, setPageIndex] = useState(initialIndex >= 0 ? initialIndex : Math.min(currentPage + 1, pages.length - 1));
  const [url, setUrl] = useState(initial?.kind === 'url' ? initial.url : '');
  const normalised = normaliseUrl(url);
  const valid = kind === 'page' ? !!pages[pageIndex] : !!normalised;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label={initial ? 'Edit link' : 'Add link'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (kind === 'page' && pages[pageIndex]) onSave({ kind: 'page', pageId: pages[pageIndex].id });
          else if (kind === 'url' && normalised) onSave({ kind: 'url', url: normalised });
        }}
      >
        <h2>{initial ? 'Edit link' : 'Add link'}</h2>
        <div className="segmented" role="radiogroup" aria-label="Link to">
          <button type="button" role="radio" aria-checked={kind === 'page'} className={kind === 'page' ? 'active' : ''} onClick={() => setKind('page')}>
            A page
          </button>
          <button type="button" role="radio" aria-checked={kind === 'url'} className={kind === 'url' ? 'active' : ''} onClick={() => setKind('url')}>
            A web address
          </button>
        </div>
        {kind === 'page' ? (
          <label className="field">
            <span>Page</span>
            <select value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))} className="link-select">
              {pages.map((p, i) => (
                <option key={p.id} value={i}>
                  Page {i + 1}
                  {i === currentPage ? ' (this page)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Web address</span>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com/notes" inputMode="url" autoCapitalize="off" spellCheck={false} aria-invalid={!!url && !normalised} />
            {url && !normalised && <span className="field-error">Enter a web address like example.com, or an https:// or mailto: link.</span>}
          </label>
        )}
        <div className="modal-actions">
          {onRemove && (
            <button type="button" className="btn ghost danger-text" onClick={onRemove} style={{ marginRight: 'auto' }}>
              Remove link
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {initial ? 'Save' : 'Add link'}
          </button>
        </div>
      </form>
    </div>
  );
}
