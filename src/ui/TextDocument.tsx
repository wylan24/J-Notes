// The text document editor: typed documents with headings, lists, checklists, tables and images.
// Loaded only when a text document is opened. The content is a Yjs document (TipTap
// Collaboration), so typing on other devices merges in rather than replacing it. Each burst of
// typing is saved through the document store as one `text.yjs` op, logged and synced like any edit.
import { useEffect, useReducer, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import type { NotebookMeta, TextDocNode } from '../core/model';
import type { DocumentStore } from '../core/store';
import { newId } from '../core/ids';
import { canonical } from '../core/librarySync';
import { forStorage, textDocBlobIds, textDocLines, textDocPlain } from '../core/textDoc';
import { fromBase64, toBase64 } from '../core/textSync';
import { openTextYDoc, setImageUrls, textExtensions } from '../text/yText';
import { HIGHLIGHT } from '../core/richText';
import { getBlobs, putBlob, updateMeta } from '../storage/db';
import { Persister, type SaveStatus } from '../storage/persister';
import { afterEditorClose } from '../storage/quicknotes';
import { downloadBlob, renderTextThumbnail } from '../render/page';
import { bytesToDataUrl, referencedBlobIds, toFile } from '../io/notebookFile';
import { TabsBar } from './TabsBar';
import { Icon } from './icons';

/** Typing settles for this long before it is saved as one change. */
const SAVE_DELAY_MS = 600;

/** Marks Yjs changes that came from elsewhere (sync), so they aren't logged again as typing here. */
const FROM_ELSEWHERE = Symbol('elsewhere');

interface Props {
  store: DocumentStore;
  meta: NotebookMeta;
  snapshotSeq: number;
  onExit: () => void;
}

export default function TextDocument({ store, meta: initialMeta, snapshotSeq, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [title, setTitle] = useState(initialMeta.title);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const urls = useRef(new Map<string, string>());
  const imageInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Typing here not yet saved, as Yjs updates. */
  const unsaved = useRef<Uint8Array[]>([]);

  /** Save typing so far as one `text.yjs` op, with the content as JSON for search and previews. */
  const save = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const editor = editorRef.current;
    if (!editor || !unsaved.current.length) return;
    const update = toBase64(Y.mergeUpdates(unsaved.current));
    unsaved.current = [];
    store.dispatch([{ type: 'text.yjs', update, text: forStorage(editor.getJSON() as TextDocNode) }]);
  };

  // Persistence, as in the notebook editor: events are batched to storage, with a thumbnail of the first lines.
  useEffect(() => {
    let lastThumb = 0;
    const docId = store.doc.id;
    const thumb = () => renderTextThumbnail(textDocLines(store.doc.text, 24));
    const persister = new Persister(store, snapshotSeq, () => {
      if (initialMeta.lock || Date.now() - lastThumb < 3000) return;
      lastThumb = Date.now();
      void updateMeta(docId, { thumbnail: thumb() });
    });
    const off = persister.onStatus(setStatus);
    const flush = () => {
      save();
      void persister.flush();
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      save();
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      afterEditorClose(
        (async () => {
          if (!initialMeta.lock) await updateMeta(docId, { thumbnail: thumb() });
          await persister.dispose();
        })(),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, snapshotSeq]);

  // The editor, made once its images are ready to show.
  useEffect(() => {
    let cancelled = false;
    let editor: Editor | null = null;
    let offStore = () => {};
    const docId = store.doc.id;
    const stored = store.doc.text;
    // Every picture the document has, including ones added on other devices.
    void getBlobs(docId).then((blobs) => {
      if (cancelled || !host.current) return;
      for (const b of blobs) urls.current.set(b.id, URL.createObjectURL(new Blob([b.bytes], { type: b.type })));
      setImageUrls((id) => urls.current.get(id));

      const extensions = textExtensions();
      const { ydoc, converted } = openTextYDoc(store.doc, extensions);
      // A document from before collaboration: log its conversion, made the same way on every device.
      if (converted) store.dispatch([{ type: 'text.yjs', update: converted, ...(stored ? { text: stored } : {}) }]);
      ydoc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === FROM_ELSEWHERE) return;
        unsaved.current.push(update);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
      });
      // Typing that arrives from other devices (sync brings a new state): merge it in.
      let seen = store.doc.textState;
      offStore = store.subscribe(() => {
        const state = store.doc.textState;
        if (!state || state === seen) return;
        seen = state;
        Y.applyUpdate(ydoc, fromBase64(state), FROM_ELSEWHERE);
      });

      editor = new Editor({
        element: host.current,
        extensions: [...extensions, Collaboration.configure({ document: ydoc })],
        // A new, empty document is ready to type in.
        autofocus: !textDocPlain(stored).trim() && !textDocBlobIds(stored).length ? 'start' : false,
        editorProps: {
          attributes: { class: 'text-doc-body', 'aria-label': 'Document', spellcheck: 'true' },
          // Pasted or dropped pictures are stored in the document, like photos in a notebook.
          handlePaste: (_view, event) => insertImageFiles([...(event.clipboardData?.files ?? [])]),
          handleDrop: (_view, event) => insertImageFiles([...((event as DragEvent).dataTransfer?.files ?? [])]),
        },
        onTransaction: () => refresh(),
        onBlur: () => save(),
      });
      editorRef.current = editor;
      // Typing merged in from elsewhere since this device last saved leaves the search copy behind.
      const json = forStorage(editor.getJSON() as TextDocNode);
      if (canonical(json) !== canonical(store.doc.text)) store.dispatch([{ type: 'text.yjs', update: '', text: json }]);
      refresh();
    });
    return () => {
      cancelled = true;
      offStore();
      if (editor) {
        save();
        editorRef.current = null;
        editor.destroy();
      }
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  /** Store image files and put them in the document at the cursor. Returns whether there were any. */
  const insertImageFiles = (files: File[]): boolean => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    void (async () => {
      for (const file of images) {
        const id = newId();
        const bytes = await file.arrayBuffer();
        await putBlob({ docId: store.doc.id, id, type: file.type, bytes });
        const src = URL.createObjectURL(new Blob([bytes], { type: file.type }));
        urls.current.set(id, src);
        // No src: each device shows the picture from its own copy of the blob.
        editorRef.current?.chain().focus().insertContent({ type: 'image', attrs: { alt: file.name, blobId: id } }).run();
      }
      save();
    })();
    return true;
  };

  const rename = (t: string) => {
    const next = t.trim() || 'Untitled document';
    setTitle(next);
    if (next !== initialMeta.title) void updateMeta(initialMeta.id, { title: next });
  };

  const exportHtml = async () => {
    save();
    const editor = editorRef.current;
    if (!editor) return;
    // Images go in as data URLs, so the file stands on its own.
    const blobs = await getBlobs(store.doc.id, textDocBlobIds(store.doc.text));
    const data = new Map(blobs.map((b) => [b.id, bytesToDataUrl(b.type, b.bytes)]));
    const body = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
    body.querySelectorAll('img').forEach((img) => {
      const id = [...urls.current].find(([, u]) => u === img.getAttribute('src'))?.[0];
      if (id && data.has(id)) img.setAttribute('src', data.get(id)!);
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${EXPORT_CSS}</style></head><body>${body.body.innerHTML}</body></html>`;
    downloadBlob(new Blob([html], { type: 'text/html' }), `${title}.html`);
  };

  const exportJson = async () => {
    save();
    const blobs = await getBlobs(store.doc.id, referencedBlobIds(store.doc));
    downloadBlob(new Blob([JSON.stringify(toFile({ ...initialMeta, title }, store.doc, blobs))], { type: 'application/json' }), `${title}.jnotes.json`);
  };

  const e = editorRef.current;
  const inTable = !!e?.isActive('table');
  const style = !e ? 'p' : e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const btn = (label: string, glyph: React.ReactNode, active: boolean, run: (ed: Editor) => void, shortcut?: string) => (
    <button
      className={`icon-btn ${active ? 'active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={!e}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={() => e && run(e)}
    >
      {glyph}
    </button>
  );

  return (
    <div className="editor text-doc">
      <TabsBar
        active={initialMeta.id}
        activeTitle={title}
        onSwitch={(id) => (location.hash = `#/n/${id}`)}
        onClosed={(id, next) => {
          if (id !== initialMeta.id) return;
          if (next) location.hash = `#/n/${next}`;
          else onExit();
        }}
      />
      <header className="toolbar text-doc-toolbar" role="toolbar" aria-label="Formatting">
        <div className="tb-group">
          <button
            className="icon-btn"
            onClick={onExit}
            aria-label="Back to library"
            title="Library"
          >
            <Icon name="back" />
          </button>
          <input className="title-input" defaultValue={title} aria-label="Document title" onBlur={(ev) => rename(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()} />
          <span className={`save-status ${status}`} aria-live="polite">
            {status === 'error' ? 'Not saved' : status === 'saved' ? 'Saved' : 'Saving…'}
          </span>
        </div>
        <div className="tb-group format-tools">
          {btn('Undo', <Icon name="undo" />, false, (ed) => ed.chain().focus().undo().run(), '⌘Z')}
          {btn('Redo', <Icon name="redo" />, false, (ed) => ed.chain().focus().redo().run(), '⇧⌘Z')}
          <span className="divider" />
          <select
            className="style-select"
            aria-label="Paragraph style"
            value={style}
            disabled={!e}
            onChange={(ev) => {
              if (!e) return;
              const v = ev.target.value;
              if (v === 'p') e.chain().focus().setParagraph().run();
              else e.chain().focus().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
          >
            <option value="p">Body text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          {btn('Bold', <b>B</b>, !!e?.isActive('bold'), (ed) => ed.chain().focus().toggleBold().run(), '⌘B')}
          {btn('Italic', <i style={{ fontFamily: 'Georgia, serif' }}>I</i>, !!e?.isActive('italic'), (ed) => ed.chain().focus().toggleItalic().run(), '⌘I')}
          {btn('Underline', <u>U</u>, !!e?.isActive('underline'), (ed) => ed.chain().focus().toggleUnderline().run(), '⌘U')}
          {btn('Strikethrough', <s>S</s>, !!e?.isActive('strike'), (ed) => ed.chain().focus().toggleStrike().run(), '⇧⌘S')}
          {btn('Highlight', <span className="hl-glyph">H</span>, !!e?.isActive('highlight'), (ed) => ed.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run(), '⇧⌘H')}
          <span className="divider" />
          {btn('Bulleted list', '•≡', !!e?.isActive('bulletList'), (ed) => ed.chain().focus().toggleBulletList().run(), '⇧⌘8')}
          {btn('Numbered list', '1.≡', !!e?.isActive('orderedList'), (ed) => ed.chain().focus().toggleOrderedList().run(), '⇧⌘7')}
          {btn('Checklist', '☑', !!e?.isActive('taskList'), (ed) => ed.chain().focus().toggleTaskList().run(), '⇧⌘9')}
          <span className="divider" />
          {btn('Insert table', '▦', false, (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
          {inTable && (
            <>
              {btn('Add row below', '+row', false, (ed) => ed.chain().focus().addRowAfter().run())}
              {btn('Add column right', '+col', false, (ed) => ed.chain().focus().addColumnAfter().run())}
              {btn('Delete row', '−row', false, (ed) => ed.chain().focus().deleteRow().run())}
              {btn('Delete column', '−col', false, (ed) => ed.chain().focus().deleteColumn().run())}
              {btn('Delete table', '✕▦', false, (ed) => ed.chain().focus().deleteTable().run())}
            </>
          )}
          {btn('Insert image', <Icon name="image" />, false, () => imageInput.current?.click())}
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(ev) => {
              insertImageFiles([...(ev.target.files ?? [])]);
              ev.target.value = '';
            }}
          />
        </div>
        <div className="tb-group">
          <details className="menu">
            <summary className="icon-btn" aria-label="Export">
              <Icon name="share" />
            </summary>
            <div className="menu-pop" onClick={(ev) => (ev.target as HTMLElement).closest('button') && ev.currentTarget.closest('details')?.removeAttribute('open')}>
              <button onClick={() => void exportHtml()}>Export as HTML</button>
              <button onClick={() => window.print()}>Print or save as PDF…</button>
              <button onClick={() => void exportJson().catch((err: Error) => alert(`Export failed: ${err.message}`))}>Export document (.jnotes.json)</button>
            </div>
          </details>
        </div>
      </header>
      <main className="text-doc-scroll">
        <article className="text-doc-sheet">
          <div ref={host} />
        </article>
      </main>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const EXPORT_CSS = `body{font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:46em;margin:3em auto;padding:0 1.5em;color:#1d1d1f}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3em .6em;vertical-align:top}th{background:#f4f4f2}
ul[data-type=taskList]{list-style:none;padding-left:.2em}ul[data-type=taskList] li{display:flex;gap:.5em}ul[data-type=taskList] p{margin:0}mark{border-radius:2px}`;
