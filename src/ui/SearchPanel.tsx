import { Fragment, useEffect, useRef, useState } from 'react';
import type { NotebookDoc } from '../core/model';
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
}

/** Stop collecting after this many matches; a query this common needs narrowing anyway. */
const MAX_RESULTS = 500;
const DEBOUNCE_MS = 250;

/**
 * Search the text of the notebook's PDF pages. Pages are searched in order and results appear as
 * they are found; typing again abandons the search in progress.
 */
export function SearchPanel({
  doc,
  onJump,
  onClose,
}: {
  doc: NotebookDoc;
  /** Show a result: scroll to its page and highlight it. */
  onJump: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
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
          placeholder="Search PDF text"
          aria-label="Search PDF text"
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
      {pdfPages.length === 0 ? (
        <p className="search-status">This notebook has no PDF pages to search.</p>
      ) : (
        <>
          <p className="search-status" aria-live="polite">
            {summary}
            {summary && searching && ' · '}
            {searching && `Searching page ${progress.done} of ${progress.total}…`}
          </p>
          <ol className="search-results">
            {results.map((r, i) => (
              <Fragment key={i}>
                {(i === 0 || results[i - 1].pageIndex !== r.pageIndex) && <li className="search-page">Page {r.pageIndex + 1}</li>}
                <li>
                  <button className={i === active ? 'active' : ''} onClick={() => show(i)}>
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
