import { useEffect, useRef, useState } from 'react';
import type { NotebookDoc, OutlineEntry } from '../core/model';
import type { DocOp } from '../core/ops';
import { hasChildren, removeOutlineEntry, renameOutlineEntry, shiftOutlineEntry, visibleOutline } from '../core/outline';
import { Icon } from './icons';

/**
 * The Outline tab of the sidebar: entries nested by level, collapsible; tap one to go to its page
 * or region. Each has a menu to rename, indent, outdent or delete it.
 */
export function OutlinePanel({
  doc,
  currentPage,
  renaming,
  onRenamed,
  onJump,
  onAddPage,
  dispatch,
  readOnly = false,
}: {
  doc: NotebookDoc;
  currentPage: number;
  /** An entry to put straight into rename mode (one just added). */
  renaming: string | null;
  onRenamed: () => void;
  onJump: (entry: OutlineEntry) => void;
  /** Add the current page to the outline. */
  onAddPage: () => void;
  dispatch: (op: DocOp | null) => void;
  /** Entries can be followed but not added or changed. */
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (renaming) setEditing(renaming);
  }, [renaming]);

  // Close the entry menu on any press outside it.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.outline-menu, .outline-more') && setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const outline = doc.outline ?? [];
  const rows = visibleOutline(doc, collapsed);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const finishRename = (id: string, title: string) => {
    dispatch(renameOutlineEntry(doc, id, title));
    setEditing(null);
    onRenamed();
  };

  const menuEntry = menu && outline.find((e) => e.id === menu.id);
  const menuIndex = menuEntry ? outline.indexOf(menuEntry) : -1;

  return (
    <div className="sidebar-scroll outline" role="tabpanel" aria-label="Outline">
      {!readOnly && (
        <button className="outline-add" onClick={onAddPage}>
          <Icon name="plus" /> Add page {currentPage + 1}
        </button>
      )}
      {rows.length === 0 ? (
        <p className="sidebar-empty">{readOnly ? 'This notebook has no outline.' : 'Add pages here, or select something with the lasso and choose “Add to outline”.'}</p>
      ) : (
        <ul role="tree" aria-label="Outline">
          {rows.map(({ entry, index, pageIndex }) => (
            <li
              key={entry.id}
              role="treeitem"
              aria-level={entry.level + 1}
              aria-expanded={hasChildren(outline, index) ? !collapsed.has(entry.id) : undefined}
              className={`outline-row ${pageIndex === currentPage ? 'current' : ''}`}
              style={{ paddingLeft: 4 + entry.level * 14 }}
            >
              {hasChildren(outline, index) ? (
                <button className={`outline-twisty ${collapsed.has(entry.id) ? 'closed' : ''}`} aria-label={collapsed.has(entry.id) ? 'Expand' : 'Collapse'} onClick={() => toggle(entry.id)}>
                  <Icon name="down" />
                </button>
              ) : (
                <span className="outline-twisty" />
              )}
              {editing === entry.id ? (
                <RenameField title={entry.title} onDone={(t) => finishRename(entry.id, t)} onCancel={() => setEditing(null)} />
              ) : (
                <button className="outline-title" onClick={() => onJump(entry)} title={entry.title}>
                  <span>{entry.title}</span>
                  <small>{pageIndex + 1}</small>
                </button>
              )}
              {!readOnly && (
                <button
                  className="outline-more"
                  aria-label={`${entry.title} options`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu(menu?.id === entry.id ? null : { id: entry.id, x: r.left, y: r.bottom });
                  }}
                >
                  <Icon name="more" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {menu && menuEntry && (
        <div className="menu-pop outline-menu" style={{ left: Math.max(8, menu.x - 160), top: Math.min(menu.y + 4, window.innerHeight - 220) }} onClick={() => setMenu(null)}>
          <button onClick={() => setEditing(menuEntry.id)}>Rename</button>
          <button onClick={() => dispatch(shiftOutlineEntry(doc, menuEntry.id, 1))} disabled={menuIndex === 0 || menuEntry.level > outline[menuIndex - 1].level}>
            Indent
          </button>
          <button onClick={() => dispatch(shiftOutlineEntry(doc, menuEntry.id, -1))} disabled={menuEntry.level === 0}>
            Outdent
          </button>
          <hr />
          <button className="danger-text" onClick={() => dispatch(removeOutlineEntry(doc, menuEntry.id))}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function RenameField({ title, onDone, onCancel }: { title: string; onDone: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="outline-rename"
      value={value}
      aria-label="Outline entry title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value);
        else if (e.key === 'Escape') onCancel();
      }}
    />
  );
}
