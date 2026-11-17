import { useEffect, useRef, useState } from 'react';
import type { NotebookMeta, Template } from '../core/model';
import { newId } from '../core/ids';
import { createNotebook, deleteNotebook, listNotebooks, updateMeta } from '../storage/db';
import { fromFile } from '../io/notebookFile';
import { Icon } from './icons';

const COVERS = ['#3d5a80', '#c8553d', '#2a9d8f', '#e9c46a', '#6d597a', '#264653'];
const TEMPLATES: { id: Template; label: string }[] = [
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'blank', label: 'Blank' },
];

type Tab = 'all' | 'favourites' | 'trash';

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<NotebookMeta[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => void listNotebooks().then(setItems);
  useEffect(refresh, []);

  const create = async (title: string, template: Template, cover: string) => {
    const id = newId();
    const now = Date.now();
    await createNotebook(
      { id, title: title.trim() || 'Untitled notebook', cover, template, createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: 1 },
      { id, pages: [{ id: newId(), template, strokes: [] }] },
    );
    onOpen(id);
  };

  const patch = async (id: string, p: Partial<NotebookMeta>) => {
    await updateMeta(id, p);
    refresh();
  };

  const importFile = async (file: File) => {
    try {
      const { meta, doc } = fromFile(JSON.parse(await file.text()));
      await createNotebook(meta, doc);
      refresh();
    } catch (e) {
      alert(`Could not import: ${(e as Error).message}`);
    }
  };

  const visible = (items ?? []).filter((n) => {
    if (tab === 'trash' ? n.trashedAt === null : n.trashedAt !== null) return false;
    if (tab === 'favourites' && !n.favourite) return false;
    return !query || n.title.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="library">
      <header className="lib-header">
        <div>
          <div className="brand">J Notes</div>
          <h1>Notebooks</h1>
        </div>
        <div className="lib-actions">
          <input className="search" placeholder="Search titles" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notebooks" />
          <button className="btn ghost" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New notebook
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {(['all', 'favourites', 'trash'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : t === 'favourites' ? 'Favourites' : 'Trash'}
          </button>
        ))}
      </nav>

      {items === null ? null : visible.length === 0 ? (
        <div className="empty">
          {tab === 'trash' ? 'Trash is empty.' : tab === 'favourites' ? 'Star a notebook to see it here.' : (
            <>
              <p>No notebooks yet.</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                Create your first notebook
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="grid">
          {visible.map((n) => (
            <li key={n.id} className="card">
              <button className="cover" onClick={() => n.trashedAt === null && onOpen(n.id)} disabled={n.trashedAt !== null} aria-label={`Open ${n.title}`}>
                <span className="spine" style={{ background: n.cover }} />
                {n.thumbnail ? <img src={n.thumbnail} alt="" /> : <span className="cover-blank" style={{ background: n.cover }} />}
              </button>
              <div className="card-meta">
                <div className="card-title" title={n.title}>
                  {n.title}
                </div>
                <div className="card-sub">
                  {n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'} · {timeAgo(n.updatedAt)}
                </div>
              </div>
              <div className="card-actions">
                {n.trashedAt === null ? (
                  <>
                    <button className={`icon-btn sm ${n.favourite ? 'starred' : ''}`} aria-label={n.favourite ? 'Unfavourite' : 'Favourite'} onClick={() => void patch(n.id, { favourite: !n.favourite })}>
                      <Icon name="star" />
                    </button>
                    <button
                      className="icon-btn sm"
                      aria-label="Rename"
                      onClick={() => {
                        const t = prompt('Rename notebook', n.title);
                        if (t?.trim()) void patch(n.id, { title: t.trim() });
                      }}
                    >
                      <Icon name="pencil" />
                    </button>
                    <button className="icon-btn sm" aria-label="Move to trash" onClick={() => void patch(n.id, { trashedAt: Date.now() })}>
                      <Icon name="trash" />
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn sm" onClick={() => void patch(n.id, { trashedAt: null })}>
                      Restore
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={async () => {
                        if (!confirm(`Permanently delete "${n.title}"? This cannot be undone.`)) return;
                        await deleteNotebook(n.id);
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && <NewNotebookDialog onCancel={() => setCreating(false)} onCreate={create} />}
    </div>
  );
}

function NewNotebookDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (title: string, t: Template, cover: string) => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<Template>('ruled');
  const [cover, setCover] = useState(COVERS[0]);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label="New notebook"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(title, template, cover);
        }}
      >
        <h2>New notebook</h2>
        <label className="field">
          <span>Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled notebook" />
        </label>
        <fieldset className="field">
          <legend>Cover</legend>
          <div className="cover-row">
            {COVERS.map((c) => (
              <button type="button" key={c} className={`cover-pick ${cover === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setCover(c)} aria-label={`Cover ${c}`} />
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Paper</legend>
          <div className="template-row">
            {TEMPLATES.map((t) => (
              <button type="button" key={t.id} className={`template-pick ${template === t.id ? 'active' : ''}`} onClick={() => setTemplate(t.id)}>
                <span className={`paper paper-${t.id}`} />
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
