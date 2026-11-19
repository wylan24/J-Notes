import { useEffect, useMemo, useRef, useState } from 'react';
import { blankPage, docKind, sizeFor, type Folder, type NotebookMeta, type Orientation, type PageSetup, type PageSizePreset, type Paper, type Template } from '../core/model';
import { PAPER_STYLES } from '../render/page';
import { TemplateGrid, type CustomTemplate } from './TemplateGrid';
import { newId } from '../core/ids';
import { allHwrEntries, createNotebook, deleteFolder, deleteNotebook, listFolders, listNotebooks, moveNotebook, putFolder, updateMeta } from '../storage/db';
import { matchSnippet } from '../core/handwriting';
import type { PageMatch } from '../core/pdfSearch';
import { indexNotebooks, useHandwritingEnabled } from '../hwr/indexer';
import { childFolders, countInFolder, effectiveFolder } from '../core/folders';
import { KIND_FILTERS, type KindFilter, NATURAL_DIR, normalizeLibraryPrefs, sortFolders, sortNotebooks, type LibraryPrefs, type SortKey } from '../core/librarySort';
import { Breadcrumbs, FolderCard, FolderDialog, FolderPicker } from './Folders';
import { COVERS, CoverPicker, EditNotebookDialog } from './CoverPicker';
import { LockSection } from './Lock';
import { relockAll } from '../core/lock';
import { fromFile } from '../io/notebookFile';
import { quicknoteTitle } from '../core/quicknote';
import { editorClosed, sweepQuicknotes } from '../storage/quicknotes';
import { pagesFromFiles, titleFromFileName } from '../io/importPages';
import { Icon } from './icons';
import { whiteboardPage } from '../core/whiteboard';
import { EMPTY_TEXT_DOC } from '../core/textDoc';
import { SettingsDialog } from './Settings';
import { usePwa } from '../pwa/register';
import { storedSettings, storeSettings, type EditorSettings } from './settingsStore';

const KIND_LABELS: Record<KindFilter, string> = { all: 'Everything', notebook: 'Notebooks', whiteboard: 'Whiteboards', text: 'Documents' };

const isNotebookFile = (f: File) => /\.json$/i.test(f.name) || f.type === 'application/json';
const SIZES: { id: PageSizePreset; label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'a5', label: 'A5' },
  { id: 'letter', label: 'Letter' },
];
const ORIENTATIONS: { id: Orientation; label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];
const PAPERS: { id: Paper; label: string }[] = [
  { id: 'white', label: 'White' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'dark', label: 'Dark' },
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
  const [folders, setFolders] = useState<Folder[]>([]);
  // The open folder, kept for the session so returning from a notebook comes back to it.
  const [folder, setFolderState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('jnotes.folder');
    } catch {
      return null;
    }
  });
  const setFolder = (id: string | null) => {
    setFolderState(id);
    try {
      if (id) sessionStorage.setItem('jnotes.folder', id);
      else sessionStorage.removeItem('jnotes.folder');
    } catch {
      // Storage unavailable: the folder just isn't remembered.
    }
  };
  const [folderDialog, setFolderDialog] = useState<{ edit?: Folder } | null>(null);
  const [editing, setEditing] = useState<NotebookMeta | null>(null);
  const [moving, setMoving] = useState<{ kind: 'notebook' | 'folder'; id: string; name: string; current: string | null } | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  // Sort order and grid/list layout, remembered in this browser.
  const [prefs, setPrefsState] = useState<LibraryPrefs>(() => {
    try {
      return normalizeLibraryPrefs(JSON.parse(localStorage.getItem('jnotes.library') ?? 'null'));
    } catch {
      return normalizeLibraryPrefs(null);
    }
  });
  const setPrefs = (patch: Partial<LibraryPrefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem('jnotes.library', JSON.stringify(next));
      } catch {
        // Not remembered, but still applied.
      }
      return next;
    });
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<EditorSettings | null>(null);
  const { install } = usePwa();
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const hwrOn = useHandwritingEnabled();
  // Notebooks whose handwriting matches the search, with the first match.
  const [inkHits, setInkHits] = useState<Map<string, PageMatch>>(new Map());

  const refresh = () =>
    // Wait for a notebook that was just closed to finish saving (and an empty quick note to go).
    void editorClosed()
      .then(() => Promise.all([listNotebooks(), listFolders()]))
      .then(([n, f]) => {
        setFolders(f);
        setItems(n);
      });
  useEffect(() => {
    // Back in the library: notebooks unlocked in the editor are locked again.
    relockAll();
    refresh();
    // Quick notes left empty in a tab that was closed rather than exited.
    void editorClosed()
      .then(() => sweepQuicknotes())
      .then((removed) => removed && refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A new whiteboard, straight into the editor. */
  const newWhiteboard = async () => {
    const id = newId();
    const now = Date.now();
    await createNotebook(
      { id, kind: 'whiteboard', title: 'Untitled whiteboard', cover: COVERS[0], template: 'dotted', createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: 1, ...fileHere },
      { id, pages: [whiteboardPage(newId())] },
    );
    onOpen(id);
  };

  /** A new text document, straight into its editor. */
  const newTextDoc = async () => {
    const id = newId();
    const now = Date.now();
    await createNotebook(
      { id, kind: 'text', title: 'Untitled document', cover: COVERS[0], template: 'blank', createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: 0, ...fileHere },
      { id, pages: [], text: EMPTY_TEXT_DOC },
    );
    onOpen(id);
  };

  /** A blank notebook straight into the editor; thrown away if left empty. */
  const quicknote = async () => {
    const id = newId();
    const now = new Date();
    await createNotebook(
      {
        id,
        title: quicknoteTitle(now),
        cover: COVERS[0],
        template: 'ruled',
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
        favourite: false,
        trashedAt: null,
        pageCount: 1,
        quicknote: true,
        ...(folder && folders.some((f) => f.id === folder) ? { folderId: folder } : {}),
      },
      { id, pages: [blankPage(newId(), { template: 'ruled', size: sizeFor('a4', 'portrait'), paper: 'white' })] },
    );
    onOpen(id);
  };

  const folderIds = new Set(folders.map((f) => f.id));
  // A remembered folder that has since been deleted falls back to the top level.
  const here = folder && folderIds.has(folder) ? folder : null;
  const fileHere = here ? { folderId: here } : {};

  const saveFolder = async (name: string, color: string) => {
    const edit = folderDialog?.edit;
    await putFolder(edit ? { ...edit, name, color } : { id: newId(), name, color, parentId: here, createdAt: Date.now() });
    setFolderDialog(null);
    refresh();
  };

  const removeFolder = async (f: Folder) => {
    const count = countInFolder(items ?? [], folders, f.id);
    const what = count ? ` Its ${count} ${count === 1 ? 'notebook' : 'notebooks'} will move to the trash.` : '';
    if (!confirm(`Delete the folder “${f.name}” and any folders inside it?${what}`)) return;
    await deleteFolder(f.id);
    refresh();
  };

  const moveTo = async (target: string | null) => {
    if (!moving) return;
    if (moving.kind === 'notebook') await moveNotebook(moving.id, target);
    else {
      const f = folders.find((x) => x.id === moving.id);
      if (f) await putFolder({ ...f, parentId: target });
    }
    setMoving(null);
    refresh();
  };

  const create = async (title: string, setup: PageSetup, cover: string, coverImage: string | undefined, blobs: { id: string; type: string; bytes: ArrayBuffer }[]) => {
    const id = newId();
    const now = Date.now();
    const { template } = setup;
    await createNotebook(
      { id, title: title.trim() || 'Untitled notebook', cover, ...(coverImage ? { coverImage } : {}), template, createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: 1, ...fileHere },
      { id, pages: [blankPage(newId(), setup)] },
      blobs.map((b) => ({ docId: id, ...b })),
    );
    onOpen(id);
  };

  const patch = async (id: string, p: Partial<NotebookMeta>) => {
    await updateMeta(id, p);
    refresh();
  };

  const [importing, setImporting] = useState(false);

  /**
   * Import chosen files: each .jnotes.json becomes the notebook it was exported from; PDFs and images
   * together become one new notebook (a page per PDF page and per image), which then opens.
   */
  const importFiles = async (files: File[]) => {
    setImporting(true);
    try {
      for (const file of files.filter(isNotebookFile)) {
        try {
          const { meta, doc, blobs } = fromFile(JSON.parse(await file.text()));
          await createNotebook({ ...meta, ...fileHere }, doc, blobs);
        } catch (e) {
          alert(`Could not import ${file.name}: ${(e as Error).message}`);
        }
      }
      const rest = files.filter((f) => !isNotebookFile(f));
      if (!rest.length) return refresh();
      const { pages, blobs, skipped } = await pagesFromFiles(rest);
      if (skipped.length) alert(`Could not import: ${skipped.join(', ')}`);
      if (!pages.length) return refresh();
      const id = newId();
      const now = Date.now();
      await createNotebook(
        { id, title: titleFromFileName(rest[0].name), cover: COVERS[0], template: 'blank', createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: pages.length, ...fileHere },
        { id, pages },
        blobs.map((b) => ({ docId: id, ...b })),
      );
      onOpen(id);
    } finally {
      setImporting(false);
    }
  };

  // Read the handwriting of notebooks that aren't open, while the library is shown, so search finds
  // them. Locked notebooks are left alone.
  const toIndex = (items ?? []).filter((n) => n.trashedAt === null && !n.lock && docKind(n) !== 'text').map((n) => n.id).join();
  useEffect(() => {
    if (!hwrOn || !toIndex) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => void indexNotebooks(toIndex.split(','), ctl.signal), 3000);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [hwrOn, toIndex]);

  // Search handwriting as well as titles.
  useEffect(() => {
    const text = query.trim();
    if (!hwrOn || !text) return setInkHits(new Map());
    let live = true;
    const timer = setTimeout(async () => {
      const byDoc = new Map<string, string[]>();
      for (const e of await allHwrEntries().catch(() => [])) byDoc.set(e.docId, [...(byDoc.get(e.docId) ?? []), e.text]);
      const hits = new Map<string, PageMatch>();
      for (const [docId, texts] of byDoc) {
        const m = matchSnippet(texts, text);
        if (m) hits.set(docId, m);
      }
      if (live) setInkHits(hits);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hwrOn, query]);
  const inkHit = (n: NotebookMeta) => (n.lock ? undefined : inkHits.get(n.id));

  // Browsing shows one folder's contents; searching looks through every folder.
  const q = query.trim().toLowerCase();
  const browsing = tab === 'all' && !q;
  const matching = (items ?? []).filter((n) => {
    if (tab === 'trash' ? n.trashedAt === null : n.trashedAt !== null) return false;
    if (tab === 'favourites' && !n.favourite) return false;
    if (prefs.kind !== 'all' && docKind(n) !== prefs.kind) return false;
    if (browsing) return effectiveFolder(n, folderIds) === here;
    return !q || n.title.toLowerCase().includes(q) || !!inkHit(n);
  });
  const visible = sortNotebooks(matching, prefs.sort, prefs.dir);
  const shownFolders = sortFolders(
    tab !== 'all' ? [] : q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : childFolders(folders, here),
    folders,
    items ?? [],
    prefs.sort,
    prefs.dir,
  );
  const dateLabel = (n: NotebookMeta) => (prefs.sort === 'created' ? `created ${timeAgo(n.createdAt)}` : timeAgo(n.updatedAt));

  return (
    <div className="library">
      <header className="lib-header">
        <div>
          <div className="brand">J Notes</div>
          <h1>Notebooks</h1>
        </div>
        <div className="lib-actions">
          {install && (
            <button className="btn ghost" onClick={() => void install()} title="Install J Notes as an app that works offline">
              Install
            </button>
          )}
          <button className="icon-btn" onClick={() => setSettings(storedSettings())} aria-label="Settings" title="Settings">
            <Icon name="settings" />
          </button>
          <input className="search" placeholder={hwrOn ? 'Search titles and handwriting' : 'Search titles'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notebooks" />
          <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={importing} title="Import a J Notes notebook, a PDF, or images">
            {importing ? 'Importing…' : 'Import'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json,.pdf,application/pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void importFiles(files);
            }}
          />
          {tab === 'all' && (
            <button className="btn ghost" onClick={() => setFolderDialog({})}>
              <Icon name="folder" /> New folder
            </button>
          )}
          <button className="btn ghost" onClick={() => void quicknote()} title="A blank notebook, discarded if you leave it empty">
            <Icon name="pencil" /> Quick note
          </button>
          <button className="btn ghost" onClick={() => void newTextDoc()} title="A typed document with headings, lists, checklists, tables and pictures">
            <Icon name="plus" /> Document
          </button>
          <button className="btn ghost" onClick={() => void newWhiteboard()} title="One endless page for diagrams and brainstorming">
            <Icon name="plus" /> Whiteboard
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New notebook
          </button>
        </div>
      </header>

      <div className="tabs-row">
        <nav className="tabs" role="tablist">
          {(['all', 'favourites', 'trash'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'all' ? 'All' : t === 'favourites' ? 'Favourites' : 'Trash'}
            </button>
          ))}
        </nav>
        <div className="view-controls">
          <label className="sort-select">
            <span>Show</span>
            <select value={prefs.kind} onChange={(e) => setPrefs({ kind: e.target.value as KindFilter })} aria-label="Show">
              {KIND_FILTERS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="sort-select">
            <span>Sort</span>
            <select value={prefs.sort} onChange={(e) => setPrefs({ sort: e.target.value as SortKey, dir: NATURAL_DIR[e.target.value as SortKey] })} aria-label="Sort by">
              <option value="modified">Date modified</option>
              <option value="created">Date created</option>
              <option value="name">Name</option>
            </select>
          </label>
          <button
            className="icon-btn sm"
            onClick={() => setPrefs({ dir: prefs.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={prefs.sort === 'name' ? (prefs.dir === 'asc' ? 'A to Z; switch to Z to A' : 'Z to A; switch to A to Z') : prefs.dir === 'desc' ? 'Newest first; switch to oldest first' : 'Oldest first; switch to newest first'}
            title={prefs.sort === 'name' ? (prefs.dir === 'asc' ? 'A → Z' : 'Z → A') : prefs.dir === 'desc' ? 'Newest first' : 'Oldest first'}
          >
            <Icon name={prefs.dir === 'asc' ? 'up' : 'down'} />
          </button>
          <div className="segmented view-toggle" role="radiogroup" aria-label="Layout">
            {(['grid', 'list'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={prefs.view === v} aria-label={v === 'grid' ? 'Grid' : 'List'} title={v === 'grid' ? 'Grid' : 'List'} className={prefs.view === v ? 'active' : ''} onClick={() => setPrefs({ view: v })}>
                <Icon name={v} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {browsing && <Breadcrumbs folders={folders} current={here} onNavigate={setFolder} />}

      {items === null ? null : visible.length === 0 && shownFolders.length === 0 ? (
        <div className="empty">
          {tab === 'trash' ? 'Trash is empty.' : tab === 'favourites' ? 'Star a notebook to see it here.' : q ? 'Nothing matches your search.' : here ? (
            <>
              <p>This folder is empty.</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                New notebook here
              </button>
            </>
          ) : (
            <>
              <p>No notebooks yet.</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                Create your first notebook
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className={prefs.view === 'list' ? 'list' : 'grid'}>
          {shownFolders.map((f) => (
            <FolderCard
              key={f.id}
              folder={f}
              count={countInFolder(items, folders, f.id)}
              subfolders={childFolders(folders, f.id).length}
              onOpen={() => {
                setQuery('');
                setFolder(f.id);
              }}
              onEdit={() => setFolderDialog({ edit: f })}
              onMove={() => setMoving({ kind: 'folder', id: f.id, name: f.name, current: f.parentId })}
              onDelete={() => void removeFolder(f)}
            />
          ))}
          {visible.map((n) => (
            <li key={n.id} className="card">
              <button className="cover" onClick={() => n.trashedAt === null && onOpen(n.id)} disabled={n.trashedAt !== null} aria-label={`Open ${n.title}`}>
                <span className="spine" style={{ background: n.cover }} />
                {n.lock && (
                  <span className="cover-lock" title="Locked">
                    <Icon name="lock" />
                  </span>
                )}
                {/* A locked notebook never shows its first page; a chosen cover picture is fine. */}
                {n.coverImage || (n.thumbnail && !n.lock) ? (
                  <img src={n.coverImage ?? n.thumbnail} alt="" />
                ) : (
                  <span className="cover-blank" style={{ background: n.cover }} />
                )}
              </button>
              {/* Clicking the title opens too (the cover button is the keyboard and screen reader target). */}
              <div className="card-meta" onClick={() => n.trashedAt === null && onOpen(n.id)}>
                <div className="card-title" title={n.title}>
                  {n.title}
                </div>
                {q && inkHit(n) && (
                  <div className="card-ink" title="In handwriting">
                    ✎ {inkHit(n)!.snippet.slice(0, inkHit(n)!.start)}
                    <mark>{inkHit(n)!.snippet.slice(inkHit(n)!.start, inkHit(n)!.end)}</mark>
                    {inkHit(n)!.snippet.slice(inkHit(n)!.end)}
                  </div>
                )}
                <div className="card-sub">
                  {docKind(n) === 'whiteboard' ? 'Whiteboard' : docKind(n) === 'text' ? 'Document' : `${n.pageCount} ${n.pageCount === 1 ? 'page' : 'pages'}`} · {dateLabel(n)}
                </div>
              </div>
              <div className="card-actions">
                {n.trashedAt === null ? (
                  <>
                    <button className={`icon-btn sm ${n.favourite ? 'starred' : ''}`} aria-label={n.favourite ? 'Unfavourite' : 'Favourite'} onClick={() => void patch(n.id, { favourite: !n.favourite })}>
                      <Icon name="star" />
                    </button>
                    <button className="icon-btn sm" aria-label={`Edit ${n.title}`} title="Rename or change cover" onClick={() => setEditing(n)}>
                      <Icon name="pencil" />
                    </button>
                    <button
                      className="icon-btn sm"
                      aria-label={`Move ${n.title} to a folder`}
                      title="Move to folder"
                      onClick={() => setMoving({ kind: 'notebook', id: n.id, name: n.title, current: effectiveFolder(n, folderIds) })}
                    >
                      <Icon name="folder" />
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

      {settings && (
        <SettingsDialog
          values={settings}
          onChange={(p) => {
            storeSettings(p);
            setSettings({ ...settings, ...p });
          }}
          onClose={() => setSettings(null)}
        />
      )}
      {creating && <NewNotebookDialog onCancel={() => setCreating(false)} onCreate={create} />}
      {editing && (
        <EditNotebookDialog
          title={editing.title}
          cover={editing.cover}
          coverImage={editing.coverImage}
          onCancel={() => setEditing(null)}
          onSave={(title, cover, coverImage) => {
            // A rename also keeps a quick note, as renaming in the editor does.
            void patch(editing.id, { title, cover, coverImage, ...(title !== editing.title ? { quicknote: undefined } : {}) });
            setEditing(null);
          }}
        >
          <LockSection
            lock={editing.lock}
            onChange={(lock) => {
              // The lock is saved at once. Locking also drops the page thumbnail, which would show the notebook's content.
              void patch(editing.id, lock ? { lock, thumbnail: undefined } : { lock: undefined });
              setEditing({ ...editing, lock, ...(lock ? { thumbnail: undefined } : {}) });
            }}
          />
        </EditNotebookDialog>
      )}
      {folderDialog && <FolderDialog folder={folderDialog.edit} onCancel={() => setFolderDialog(null)} onSave={(name, color) => void saveFolder(name, color)} />}
      {moving && (
        <FolderPicker
          folders={folders}
          title={`Move “${moving.name}” to…`}
          current={moving.current}
          moving={moving.kind === 'folder' ? moving.id : undefined}
          onCancel={() => setMoving(null)}
          onPick={(id) => void moveTo(id)}
        />
      )}
    </div>
  );
}

/** A row of mutually exclusive text buttons. */
function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button type="button" key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function NewNotebookDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (title: string, setup: PageSetup, cover: string, coverImage: string | undefined, blobs: CustomTemplate['blob'][]) => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<Template | 'image'>('ruled');
  const [custom, setCustom] = useState<CustomTemplate | null>(null);
  const [preset, setPreset] = useState<PageSizePreset>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [paper, setPaper] = useState<Paper>('white');
  const [cover, setCover] = useState(COVERS[0]);
  const [coverImage, setCoverImage] = useState<string | undefined>();
  const size = useMemo(() => sizeFor(preset, orientation), [preset, orientation]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label="New notebook"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (template === 'image' && custom) onCreate(title, { template: 'blank', size, paper, background: { kind: 'image', blobId: custom.blob.id } }, cover, coverImage, [custom.blob]);
          else onCreate(title, { template: template === 'image' ? 'blank' : template, size, paper }, cover, coverImage, []);
        }}
      >
        <h2>New notebook</h2>
        <label className="field">
          <span>Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled notebook" />
        </label>
        <CoverPicker color={cover} onColor={setCover} image={coverImage} onImage={setCoverImage} />
        <Segmented label="Size" options={SIZES} value={preset} onChange={setPreset} />
        <Segmented label="Orientation" options={ORIENTATIONS} value={orientation} onChange={setOrientation} />
        <fieldset className="field">
          <legend>Paper colour</legend>
          <div className="cover-row" role="radiogroup" aria-label="Paper colour">
            {PAPERS.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={paper === p.id}
                className={`cover-pick paper-pick ${paper === p.id ? 'active' : ''}`}
                style={{ background: PAPER_STYLES[p.id].fill }}
                onClick={() => setPaper(p.id)}
                aria-label={p.label}
                title={p.label}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Template</legend>
          <TemplateGrid size={size} paper={paper} value={template} onChange={setTemplate} custom={custom} onCustom={setCustom} />
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
