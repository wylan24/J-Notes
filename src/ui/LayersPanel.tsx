import { useEffect, useRef, useState } from 'react';
import type { Page } from '../core/model';
import {
  addLayerOp,
  deleteLayerOps,
  layerCount,
  moveLayerOp,
  pageLayers,
  renameLayerOp,
  setLayerFlagOp,
} from '../core/layers';
import type { DocOp } from '../core/ops';
import { Icon } from './icons';

/** Why a tool did nothing on a hidden or locked layer, for a notice. */
export function layerNotice(name: string, why: 'hidden' | 'locked'): string {
  return why === 'hidden' ? `“${name}” is hidden · Show it or pick another layer to draw` : `“${name}” is locked · Unlock it or pick another layer to draw`;
}

/**
 * The current page's layers, top first: pick the one tools work on, add, rename, reorder, hide,
 * lock and delete them, and export chosen layers.
 */
export function LayersPanel({
  page,
  pageLabel,
  activeId,
  readOnly,
  onSelect,
  dispatch,
  onExport,
  onClose,
}: {
  page: Page;
  /** "Page 3", or "Board". */
  pageLabel: string;
  activeId: string;
  readOnly: boolean;
  onSelect: (layerId: string) => void;
  dispatch: (ops: DocOp[]) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const layers = pageLayers(page);
  const [renaming, setRenaming] = useState<string | null>(null);
  const top = layers.length - 1;

  const add = () => {
    const { op, id } = addLayerOp(page, activeId);
    dispatch([op]);
    onSelect(id);
    setRenaming(id);
  };

  const remove = (id: string, name: string) => {
    const n = layerCount(page, id);
    if (n && !confirm(`Delete “${name}” and the ${n} ${n === 1 ? 'thing' : 'things'} on it? Undo brings it back.`)) return;
    dispatch(deleteLayerOps(page, id));
  };

  const one = (op: DocOp | null) => op && dispatch([op]);

  return (
    <div className="layers-panel" data-no-gesture role="dialog" aria-label="Layers">
      <div className="layers-head">
        <h2>
          Layers <small>{pageLabel}</small>
        </h2>
        <button className="icon-btn sm" aria-label="Close layers" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <ol className="layers-list">
        {layers
          .map((l, i) => ({ l, i }))
          .reverse()
          .map(({ l, i }) => {
            const active = l.id === activeId;
            return (
              <li key={l.id} className={`layer-row ${active ? 'active' : ''} ${l.hidden ? 'is-hidden' : ''}`}>
                {renaming === l.id && !readOnly ? (
                  <RenameField
                    name={l.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null) one(renameLayerOp(page, l.id, name));
                    }}
                  />
                ) : (
                  <button
                    className="layer-name"
                    aria-pressed={active}
                    title={active ? 'Tools draw on this layer (double-click to rename)' : 'Draw on this layer'}
                    onClick={() => onSelect(l.id)}
                    onDoubleClick={() => !readOnly && setRenaming(l.id)}
                  >
                    <span>{l.name}</span>
                    <small>{layerCount(page, l.id) || 'Empty'}</small>
                  </button>
                )}
                <button
                  className={`icon-btn sm ${l.hidden ? 'active' : ''}`}
                  aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`}
                  title={l.hidden ? 'Hidden (tap to show)' : 'Hide'}
                  aria-pressed={!!l.hidden}
                  disabled={readOnly}
                  onClick={() => one(setLayerFlagOp(page, l.id, 'hidden', !l.hidden))}
                >
                  <Icon name={l.hidden ? 'eyeOff' : 'eye'} />
                </button>
                <button
                  className={`icon-btn sm ${l.locked ? 'active' : ''}`}
                  aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}
                  title={l.locked ? 'Locked (tap to unlock)' : 'Lock'}
                  aria-pressed={!!l.locked}
                  disabled={readOnly}
                  onClick={() => one(setLayerFlagOp(page, l.id, 'locked', !l.locked))}
                >
                  <Icon name={l.locked ? 'lock' : 'unlock'} />
                </button>
                {!readOnly && (
                  <details className="menu">
                    <summary className="icon-btn sm" aria-label={`More for ${l.name}`} title="More">
                      <Icon name="more" />
                    </summary>
                    <div className="menu-pop" onClick={(e) => (e.target as HTMLElement).closest('button') && e.currentTarget.closest('details')?.removeAttribute('open')}>
                      <button onClick={() => setRenaming(l.id)}>Rename</button>
                      <button disabled={i === top} onClick={() => one(moveLayerOp(page, l.id, i + 1))}>
                        Move up
                      </button>
                      <button disabled={i === 0} onClick={() => one(moveLayerOp(page, l.id, i - 1))}>
                        Move down
                      </button>
                      <button className="danger" disabled={layers.length <= 1} onClick={() => remove(l.id, l.name)}>
                        Delete
                      </button>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
      </ol>
      <div className="layers-foot">
        {!readOnly && (
          <button className="btn sm" onClick={add}>
            <Icon name="plus" /> Add layer
          </button>
        )}
        <button className="btn sm ghost" onClick={onExport}>
          Export layers…
        </button>
      </div>
    </div>
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className="layer-rename"
      value={value}
      aria-label="Layer name"
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

/** Choose which of a page's layers to export, as PNG or PDF. */
export function LayerExportDialog({
  page,
  onCancel,
  onExport,
}: {
  page: Page;
  onCancel: () => void;
  onExport: (layerIds: ReadonlySet<string>, format: 'png' | 'pdf') => Promise<void>;
}) {
  const layers = pageLayers(page);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(layers.filter((l) => !l.hidden).map((l) => l.id)));
  const [busy, setBusy] = useState(false);
  const run = async (format: 'png' | 'pdf') => {
    setBusy(true);
    try {
      await onExport(chosen, format);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="modal" role="dialog" aria-label="Export layers" onClick={(e) => e.stopPropagation()}>
        <h2>Export layers</h2>
        <fieldset className="field" disabled={busy}>
          <legend>Layers to include</legend>
          {[...layers].reverse().map((l) => (
            <label key={l.id} className="check-row">
              <input
                type="checkbox"
                checked={chosen.has(l.id)}
                onChange={(e) =>
                  setChosen((c) => {
                    const next = new Set(c);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    return next;
                  })
                }
              />
              <span>
                {l.name}
                {l.hidden && <small>Hidden on the page</small>}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!chosen.size || busy} onClick={() => void run('png')}>
            Export PNG
          </button>
          <button type="button" className="btn primary" disabled={!chosen.size || busy} onClick={() => void run('pdf')}>
            {busy ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
