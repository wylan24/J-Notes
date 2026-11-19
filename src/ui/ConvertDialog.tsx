import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Stroke } from '../core/model';
import type { InkLine, InkParagraph } from '../core/segment';
import { inkKey } from '../core/handwriting';
import { convertedText } from '../core/spelling';
import type { HandwritingIndex } from '../hwr/indexer';
import { lineImage, onRecognizerStatus, recognise, recognizerStatus, startRecognizer } from '../hwr/recognizer';

type Phase = 'ask' | 'reading' | 'ready' | 'error';

/**
 * Convert handwriting to text: read it (from the handwriting cache where it has been read
 * already), show the text to check and correct, then replace the ink with it or copy it.
 */
export function ConvertDialog({
  paragraphs,
  strokes,
  handwriting,
  onReplace,
  onClose,
}: {
  paragraphs: InkParagraph[];
  /** The selected strokes, which the lines refer to by id. */
  strokes: Stroke[];
  /** The notebook's recognised handwriting; null when recognition is off. */
  handwriting: HandwritingIndex | null;
  onReplace: (text: string) => void;
  onClose: () => void;
}) {
  const status = useSyncExternalStore(onRecognizerStatus, recognizerStatus);
  const lines = paragraphs.flatMap((p) => p.lines);
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const inkOf = (l: InkLine) => l.strokeIds.flatMap((id) => byId.get(id) ?? []);
  const cached = (l: InkLine) => handwriting?.textOf(inkKey(inkOf(l)));
  const allCached = lines.every((l) => cached(l) !== undefined);
  // Without recognition on, the model hasn't been downloaded: ask before fetching 70 MB.
  const [phase, setPhase] = useState<Phase>(() => (allCached || handwriting || status.state === 'ready' ? 'reading' : 'ask'));
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (phase !== 'reading') return;
    let live = true;
    void (async () => {
      const texts = new Map<InkLine, string>();
      try {
        for (const l of lines) {
          texts.set(l, cached(l) ?? (await recognise(lineImage(inkOf(l), l))));
          if (!live) return;
        }
        setText(convertedText(paragraphs, (l) => texts.get(l)));
        setPhase('ready');
      } catch (e) {
        if (!live) return;
        setError((e as Error).message || String(e));
        setPhase('error');
      }
    })();
    return () => {
      live = false;
    };
    // Read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal convert" role="dialog" aria-label="Convert to text" onClick={(e) => e.stopPropagation()}>
        <h2>Convert to text</h2>
        {phase === 'ask' && (
          <p className="setting-hint">
            Your writing is read on this device by a model that downloads once (about 70 MB) and then works offline. To
            have notebooks read in the background and made searchable, turn on Recognise handwriting in Settings.
          </p>
        )}
        {phase === 'reading' && (
          <p className="setting-hint" aria-live="polite">
            {status.state === 'loading' && status.total
              ? `Downloading the reading model: ${mb(status.loaded)} of ${mb(status.total)}…`
              : status.state === 'loading'
                ? 'Starting the reading model…'
                : `Reading ${lines.length === 1 ? 'the line' : `${lines.length} lines`}…`}
          </p>
        )}
        {phase === 'error' && <p className="setting-hint">Couldn’t read the writing: {error}</p>}
        {phase === 'ready' && (
          <>
            <p className="setting-hint">Check the text and correct anything misread before using it.</p>
            <textarea className="convert-text" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(10, Math.max(3, text.split('\n').length + 1))} autoFocus />
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          {phase === 'ask' && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void startRecognizer().catch(() => {});
                setPhase('reading');
              }}
            >
              Download and convert
            </button>
          )}
          {phase === 'error' && (
            <button type="button" className="btn primary" onClick={() => setPhase('reading')}>
              Try again
            </button>
          )}
          {phase === 'ready' && (
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={!text.trim()}
                onClick={() => {
                  void navigator.clipboard?.writeText(text).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
              <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onReplace(text.trim())}>
                Replace ink with text
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
