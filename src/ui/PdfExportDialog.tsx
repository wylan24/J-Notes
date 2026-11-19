import { useState } from 'react';
import { parsePageRange } from '../core/pdfPlacement';

type Range = 'all' | 'current' | 'custom';

/** Choose what to export as PDF: all pages, the current page, or a range; with or without backgrounds. */
export function PdfExportDialog({
  pageCount,
  currentPage,
  layerNames,
  shownLayerNames,
  onCancel,
  onExport,
}: {
  pageCount: number;
  currentPage: number;
  /** Names of the notebook's layers; a choice is offered when there is more than one. */
  layerNames: string[];
  /** The names of layers shown on at least one page; chosen at first. */
  shownLayerNames: string[];
  onCancel: () => void;
  /** `layers`: names of the layers to export, or null for what is shown on each page. */
  onExport: (pages: number[], background: boolean, layers: ReadonlySet<string> | null) => Promise<void>;
}) {
  const choosing = layerNames.length > 1;
  const [layers, setLayers] = useState<ReadonlySet<string>>(() => new Set(shownLayerNames));
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState(`1-${pageCount}`);
  const [background, setBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const pages =
    range === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : range === 'current' ? [currentPage] : parsePageRange(custom, pageCount);
  const invalid = !pages?.length || (choosing && !layers.size);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <form
        className="modal"
        role="dialog"
        aria-label="Export as PDF"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pages?.length) return;
          setBusy(true);
          try {
            await onExport(pages, background, choosing ? layers : null);
          } catch (err) {
            alert(`Export failed: ${(err as Error).message}`);
            setBusy(false);
          }
        }}
      >
        <h2>Export as PDF</h2>
        <fieldset className="field" disabled={busy}>
          <legend>Pages</legend>
          <label className="radio-row">
            <input type="radio" name="range" checked={range === 'all'} onChange={() => setRange('all')} />
            All pages ({pageCount})
          </label>
          <label className="radio-row">
            <input type="radio" name="range" checked={range === 'current'} onChange={() => setRange('current')} />
            Current page ({currentPage + 1})
          </label>
          <label className="radio-row">
            <input type="radio" name="range" checked={range === 'custom'} onChange={() => setRange('custom')} />
            Pages
            <input
              className="range-input"
              value={custom}
              aria-label="Page range"
              placeholder="e.g. 1-3, 7"
              onFocus={() => setRange('custom')}
              onChange={(e) => setCustom(e.target.value)}
              aria-invalid={range === 'custom' && invalid}
            />
          </label>
          {range === 'custom' && invalid && <span className="field-error">Enter page numbers or ranges, like 1-3, 7.</span>}
        </fieldset>
        {choosing && (
          <fieldset className="field" disabled={busy}>
            <legend>Layers</legend>
            {layerNames.map((name) => (
              <label key={name} className="check-row">
                <input
                  type="checkbox"
                  checked={layers.has(name)}
                  onChange={(e) =>
                    setLayers((c) => {
                      const next = new Set(c);
                      if (e.target.checked) next.add(name);
                      else next.delete(name);
                      return next;
                    })
                  }
                />
                <span>{name}</span>
              </label>
            ))}
            {!layers.size && <span className="field-error">Choose at least one layer.</span>}
          </fieldset>
        )}
        <label className="check-row">
          <input type="checkbox" checked={background} disabled={busy} onChange={(e) => setBackground(e.target.checked)} />
          <span>
            Include page backgrounds
            <small>PDF pages, paper colour and templates. Turn off to export only what you added.</small>
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={invalid || busy}>
            {busy ? 'Exporting…' : `Export ${pages?.length ?? 0} ${pages?.length === 1 ? 'page' : 'pages'}`}
          </button>
        </div>
      </form>
    </div>
  );
}
