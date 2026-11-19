import { useState } from 'react';
import { canMoveFolder, childFolders, FOLDER_COLORS, folderPath, parseHexColor } from '../core/folders';
import type { Folder } from '../core/model';
import { Icon } from './icons';

/** Create or edit a folder: its name and colour (swatches, the system colour wheel, or a HEX value). */
export function FolderDialog({
  folder,
  onCancel,
  onSave,
}: {
  /** The folder being edited; absent to create one. */
  folder?: Folder;
  onCancel: () => void;
  onSave: (name: string, color: string) => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState(folder?.color ?? FOLDER_COLORS[0]);
  const [hex, setHex] = useState(color);
  const hexValid = parseHexColor(hex) !== null;
  const pick = (c: string) => {
    setColor(c);
    setHex(c);
  };
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label={folder ? 'Edit folder' : 'New folder'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name.trim() || 'Untitled folder', color);
        }}
      >
        <h2>{folder ? 'Edit folder' : 'New folder'}</h2>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled folder" />
        </label>
        <fieldset className="field">
          <legend>Colour</legend>
          <div className="cover-row folder-colors">
            {FOLDER_COLORS.map((c) => (
              <button type="button" key={c} className={`cover-pick ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => pick(c)} aria-label={`Colour ${c}`} />
            ))}
            <label className={`cover-pick color-wheel ${FOLDER_COLORS.includes(color) ? '' : 'active'}`} title="Any colour">
              <input type="color" value={color} onChange={(e) => pick(e.target.value)} aria-label="Choose any colour" />
            </label>
          </div>
          <label className="hex-row">
            <span className="hex-swatch" style={{ background: color }} />
            <input
              value={hex}
              aria-label="HEX colour"
              aria-invalid={!hexValid}
              spellCheck={false}
              onChange={(e) => {
                setHex(e.target.value);
                const c = parseHexColor(e.target.value);
                if (c) setColor(c);
              }}
              onBlur={() => setHex(color)}
            />
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {folder ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Choose where to move something: the top level or any folder. When moving a folder, it and the
 * folders inside it can't be chosen.
 */
export function FolderPicker({
  folders,
  title,
  current,
  moving,
  onCancel,
  onPick,
}: {
  folders: readonly Folder[];
  title: string;
  /** Where the item is now; shown as such and not choosable. */
  current: string | null;
  /** The folder being moved, if a folder is. */
  moving?: string;
  onCancel: () => void;
  onPick: (folderId: string | null) => void;
}) {
  const rows: { folder: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of childFolders(folders, parent)) {
      rows.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  const allowed = (id: string | null) => id !== current && (!moving || canMoveFolder(folders, moving, id));
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <ul className="notebook-pick folder-tree">
          <li>
            <button type="button" disabled={!allowed(null)} onClick={() => onPick(null)}>
              <Icon name="library" />
              <span className="notebook-pick-title">Notebooks (top level)</span>
              {current === null && <span className="muted">Current</span>}
            </button>
          </li>
          {rows.map(({ folder, depth }) => (
            <li key={folder.id}>
              <button type="button" disabled={!allowed(folder.id)} onClick={() => onPick(folder.id)} style={{ paddingLeft: 10 + depth * 18 }}>
                <span className="folder-glyph" style={{ color: folder.color }}>
                  <Icon name="folder" />
                </span>
                <span className="notebook-pick-title">{folder.name}</span>
                {current === folder.id && <span className="muted">Current</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Where you are in the folder tree; each step but the last navigates there. */
export function Breadcrumbs({ folders, current, onNavigate }: { folders: readonly Folder[]; current: string | null; onNavigate: (id: string | null) => void }) {
  const path = folderPath(folders, current);
  if (!path.length) return null;
  return (
    <nav className="breadcrumbs" aria-label="Folder">
      <button onClick={() => onNavigate(null)}>Notebooks</button>
      {path.map((f, i) => (
        <span key={f.id} className="crumb">
          <span className="crumb-sep" aria-hidden="true">
            ›
          </span>
          {i === path.length - 1 ? (
            <span aria-current="page">{f.name}</span>
          ) : (
            <button onClick={() => onNavigate(f.id)}>{f.name}</button>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A folder in the library grid. */
export function FolderCard({
  folder,
  count,
  subfolders,
  onOpen,
  onEdit,
  onMove,
  onDelete,
}: {
  folder: Folder;
  count: number;
  subfolders: number;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const parts = [`${count} ${count === 1 ? 'notebook' : 'notebooks'}`];
  if (subfolders) parts.push(`${subfolders} ${subfolders === 1 ? 'folder' : 'folders'}`);
  return (
    <li className="card">
      <button className="folder-cover" style={{ '--folder': folder.color } as React.CSSProperties} onClick={onOpen} aria-label={`Open folder ${folder.name}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.5 6.5A2 2 0 014.5 4.5h5l2 2.2h8a2 2 0 012 2v9.8a2 2 0 01-2 2h-15a2 2 0 01-2-2z" />
        </svg>
      </button>
      <div className="card-meta" onClick={onOpen}>
        <div className="card-title" title={folder.name}>
          {folder.name}
        </div>
        <div className="card-sub">{parts.join(' · ')}</div>
      </div>
      <div className="card-actions">
        <button className="icon-btn sm" aria-label={`Edit folder ${folder.name}`} title="Rename or recolour" onClick={onEdit}>
          <Icon name="pencil" />
        </button>
        <button className="icon-btn sm" aria-label={`Move folder ${folder.name}`} title="Move" onClick={onMove}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn sm" aria-label={`Delete folder ${folder.name}`} title="Delete folder" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}
