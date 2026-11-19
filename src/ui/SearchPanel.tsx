import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NotebookDoc } from '../core/model';
import { findInHandwriting } from '../core/handwriting';
import type { HandwritingIndex } from '../hwr/indexer';
import { findInPage, normaliseQuery, type PageMatch, type Rect } from '../core/pdfSearch';
import { pdfText } from '../render/pdf';
import { Icon } from './icons';

export interface SearchHit {
  pageId: string;
  rects: Rect[];
}

interface Result {
  pageId: string;
  pageIndex: number;
  match: PageMatch;
  /** Found in recognised handwriting rather than PDF text. */
  ink?: true;
}

/** Stop collecting after this many matches; a query this common needs narrowing anyway. */
const MAX_RESULTS = 500;
const DEBOUNCE_MS = 250;

const noopSubscribe = () => () => {};
const zero = () => 0;

/**
 * Search the notebook's PDF text and, when recognition is on, its handwriting. PDF pages are
 * searched in order and results appear as they are found; typing again abandons the search in
 * progress. Handwriting is searched in its stored text, so it is instant, and results grow as
 * more lines are read.
 */
export function SearchPanel({
  doc,
  handwriting,
  onJump,
  onClose,
}: {
  doc: NotebookDoc;
  /** The notebook's recognised handwriting; null when recognition is off. */
  handwriting?: HandwritingIndex | null;
  /** Show a result: scroll to its page and highlight it. */
  onJump: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pdfResults, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [active, setActive] = useState(-1);
  const run = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const pdfPages = doc.pages.filter((p) => p.background?.kind === 'pdf');

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const token = ++run.current;
    setResults([]);
    setActive(-1);
    const q = normaliseQuery(query);
    if (!q) {
      setProgress(null);
      return;
    }
    const pages = doc.pages.flatMap((p, i) => (p.background?.kind === 'pdf' ? [{ page: p, index: i, bg: p.background }] : []));
    const timer = setTimeout(async () => {
      const found: Result[] = [];
      setProgress({ done: 0, total: pages.length });
      for (const [n, { page, index, bg }] of pages.entries()) {
        let matches: PageMatch[] = [];
        try {
          matches = findInPage(await pdfText(doc.id, bg), q);
        } catch (e) {
          console.error('Could not read PDF text', e);
        }
        if (run.current !== token) return; // a newer search has started
        if (matches.length) {
          found.push(...matches.map((match) => ({ pageId: page.id, pageIndex: index, match })));
          setResults(found.slice(0, MAX_RESULTS));
        }
        setProgress({ done: n + 1, total: pages.length });
        if (found.length >= MAX_RESULTS) break;
      }
      setProgress(null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Pages are searched as they were when the query was typed; re-run only when the query or PDF pages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, doc.id, pdfPages.map((p) => p.id).join()]);

  const inkVersion = useSyncExternalStore(handwriting?.subscribe ?? noopSubscribe, handwriting?.getVersion ?? zero);
  const inkResults = useMemo(
    (): Result[] => (handwriting ? findInHandwriting(doc, handwriting.textOf, query, MAX_RESULTS).map((r) => ({ ...r, ink: true as const })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handwriting, inkVersion, doc, query],
  );
  // Both kinds, in page order (handwriting first on a page).
  const results = useMemo(() => [...inkResults, ...pdfResults].sort((a, b) => a.pageIndex - b.pageIndex).slice(0, MAX_RESULTS), [inkResults, pdfResults]);
  const reading = handwriting && handwriting.remaining > 0;

  const show = (i: number) => {
    const r = results[i];
    if (!r) return;
    setActive(i);
    onJump({ pageId: r.pageId, rects: r.match.rects });
  };

  const searching = progress !== null;
  const summary = !normaliseQuery(query)
    ? null
    : results.length
      ? `${results.length >= MAX_RESULTS ? `First ${MAX_RESULTS}` : results.length} ${results.length === 1 ? 'match' : 'matches'}`
      : searching
        ? null
        : 'No matches';

  return (
    <div className="search-panel" data-no-gesture role="search">
      <div className="search-row">
        <Icon name="search" />
        <input
          ref={input}
          value={query}
          placeholder={handwriting ? 'Search handwriting and PDF text' : 'Search PDF text'}
          aria-label={handwriting ? 'Search handwriting and PDF text' : 'Search PDF text'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results.length) show(e.shiftKey ? (active - 1 + results.length) % results.length : (active + 1) % results.length);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <button className="icon-btn sm" aria-label="Close search" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {pdfPages.length === 0 && !handwriting ? (
        <p className="search-status">This notebook has no PDF pages to search. To search handwriting, turn on Recognise handwriting in Settings.</p>
      ) : (
        <>
          <p className="search-status" aria-live="polite">
            {summary}
            {summary && searching && ' · '}
            {searching && `Searching page ${progress.done} of ${progress.total}…`}
            {reading && (summary || searching ? ' · ' : '') + `Reading handwriting (${handwriting.remaining} ${handwriting.remaining === 1 ? 'line' : 'lines'} to go)…`}
          </p>
          <ol className="search-results">
            {results.map((r, i) => (
              <Fragment key={i}>
                {(i === 0 || results[i - 1].pageIndex !== r.pageIndex) && <li className="search-page">Page {r.pageIndex + 1}</li>}
                <li>
                  <button className={i === active ? 'active' : ''} onClick={() => show(i)} title={r.ink ? 'In handwriting' : 'In PDF text'}>
                    {r.ink && <span className="search-kind">✎ </span>}
                    {r.match.snippet.slice(0, r.match.start)}
                    <mark>{r.match.snippet.slice(r.match.start, r.match.end)}</mark>
                    {r.match.snippet.slice(r.match.end)}
                  </button>
                </li>
              </Fragment>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
