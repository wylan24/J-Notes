import { useEffect, useState } from 'react';
import { pagePaper, pageSize, type NotebookMeta, type Page, type Template } from '../core/model';
import { listNotebooks } from '../storage/db';
import { TemplateGrid, type CustomTemplate } from './TemplateGrid';

/** Pick a new template, or an image, for one page. */
export function ChangeTemplateDialog({
  page,
  onCancel,
  onApply,
}: {
  page: Page;
  onCancel: () => void;
  onApply: (choice: Template | CustomTemplate) => void;
}) {
  const [value, setValue] = useState<Template | 'image'>(page.background ? 'image' : page.template);
  const [custom, setCustom] = useState<CustomTemplate | null>(null);
  // An existing image template stays as it is unless a new image is picked.
  const unchanged = value === 'image' && !custom;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label="Change template"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value === 'image') {
            if (custom) onApply(custom);
            else onCancel();
          } else onApply(value);
        }}
      >
        <h2>Change template</h2>
        <TemplateGrid size={pageSize(page)} paper={pagePaper(page)} value={value} onChange={setValue} custom={custom} onCustom={setCustom} />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={unchanged && !page.background}>
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

/** Choose another notebook to move or copy the current page to. */
export function NotebookPickerDialog({
  currentId,
  mode,
  onCancel,
  onPick,
}: {
  currentId: string;
  mode: 'move' | 'copy';
  onCancel: () => void;
  onPick: (target: NotebookMeta) => Promise<void>;
}) {
  const [notebooks, setNotebooks] = useState<NotebookMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listNotebooks().then((all) => setNotebooks(all.filter((n) => n.id !== currentId && n.trashedAt === null)));
  }, [currentId]);
  const verb = mode === 'move' ? 'Move' : 'Copy';
  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="modal" role="dialog" aria-label={`${verb} page to notebook`} onClick={(e) => e.stopPropagation()}>
        <h2>{verb} page to…</h2>
        {notebooks === null ? null : notebooks.length === 0 ? (
          <p className="muted">There are no other notebooks yet.</p>
        ) : (
          <ul className="notebook-pick">
            {notebooks.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onPick(n);
                    } catch (e) {
                      alert(`Could not ${mode} the page: ${(e as Error).message}`);
                      setBusy(false);
                    }
                  }}
                >
                  <span className="notebook-pick-cover" style={{ background: n.cover }} />
                  <span className="notebook-pick-title">{n.title}</span>
                  <span className="muted">
                    {n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
