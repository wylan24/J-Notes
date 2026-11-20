// A study set: its flashcards, stats, and study mode with SM-2 spaced repetition.
// Loaded only when a study set is opened. Cards change through the document store as `cards.*` ops,
// so every edit and every answer is logged, undoable and saved like the rest of the app.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CardSide, NotebookMeta, StudyCard } from '../core/model';
import type { DocumentStore } from '../core/store';
import {
  addCardsOp,
  advance,
  answerOps,
  buildSession,
  cardMatches,
  cardStatus,
  deckStats,
  emptySide,
  GRADES,
  intervalLabel,
  isDue,
  NEW_PER_SESSION,
  newCard,
  removeCardsOp,
  resetCardOp,
  schedule,
  sideIsEmpty,
  sideLabel,
  updateCardOp,
  cleanSide,
  type CardStatus,
  type Grade,
  type StudyMode,
} from '../core/study';
import { getBlobs, updateMeta } from '../storage/db';
import { Persister, type SaveStatus } from '../storage/persister';
import { afterEditorClose } from '../storage/quicknotes';
import { downloadBlob } from '../render/page';
import { referencedBlobIds, toFile } from '../io/notebookFile';
import { TabsBar } from './TabsBar';
import { requestPageJump } from './tabsStore';
import { COVERS } from './CoverPicker';
import { CardFace, SideEditor } from './CardFace';
import { Icon } from './icons';

interface Props {
  store: DocumentStore;
  meta: NotebookMeta;
  snapshotSeq: number;
  onExit: () => void;
}

const STATUS_LABEL: Record<CardStatus, string> = { new: 'New', learning: 'Learning', mastered: 'Mastered' };
const GRADE_LABEL: Record<Grade, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

/** When a card is next due, said briefly. */
function dueLabel(card: StudyCard, now: number): string {
  if (!card.review) return 'Not studied';
  if (isDue(card, now)) return 'Due now';
  const days = Math.round((card.review.due - now) / 86_400_000);
  return days <= 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

export default function StudySet({ store, meta: initialMeta, snapshotSeq, onExit }: Props) {
  const doc = useSyncExternalStore(store.subscribe, store.getDoc);
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [title, setTitle] = useState(initialMeta.title);
  const [color, setColor] = useState(initialMeta.cover);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [editing, setEditing] = useState<StudyCard | 'new' | null>(null);
  const [session, setSession] = useState<StudyMode | null>(null);
  const [query, setQuery] = useState('');
  // The clock for "due" is read when the view renders; a minute's tick keeps it honest on a long visit.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const persister = new Persister(store, snapshotSeq);
    const off = persister.onStatus(setStatus);
    const flush = () => void persister.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      afterEditorClose(persister.dispose());
    };
  }, [store, snapshotSeq]);

  // Undo and redo with the keyboard, outside text fields and study mode (which has its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (session || editing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, session, editing]);

  const cards = doc.cards ?? [];
  const stats = useMemo(() => deckStats(cards, doc.studyLog, now), [cards, doc.studyLog, now]);
  const shown = cards.filter((c) => cardMatches(c, query));
  const toStudy = stats.due + Math.min(stats.new, NEW_PER_SESSION);

  const rename = (t: string) => {
    const next = t.trim() || 'Untitled study set';
    setTitle(next);
    if (next !== initialMeta.title) void updateMeta(initialMeta.id, { title: next });
  };
  const recolor = (c: string) => {
    setColor(c);
    void updateMeta(initialMeta.id, { cover: c });
  };

  const saveCard = (front: CardSide, back: CardSide) => {
    if (editing === 'new') store.dispatch([addCardsOp([newCard(front, back, Date.now())])!]);
    else if (editing) {
      const op = updateCardOp(store.doc, editing.id, { front: cleanSide(front), back: cleanSide(back) });
      if (op) store.dispatch([op]);
    }
    setEditing(null);
  };

  const removeCard = (c: StudyCard) => {
    const op = removeCardsOp(store.doc, [c.id]);
    if (op) store.dispatch([op]);
  };

  const exportJson = async () => {
    const blobs = await getBlobs(store.doc.id, referencedBlobIds(store.doc));
    downloadBlob(new Blob([JSON.stringify(toFile({ ...initialMeta, title, cover: color }, store.doc, blobs))], { type: 'application/json' }), `${title}.jnotes.json`);
  };

  if (session)
    return (
      <StudyMode
        store={store}
        mode={session}
        title={title}
        color={color}
        onClose={() => {
          setNow(Date.now());
          setSession(null);
        }}
      />
    );

  return (
    <div className="editor study-set" style={{ '--deck': color } as React.CSSProperties}>
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
      <header className="toolbar" role="toolbar" aria-label="Study set">
        <div className="tb-group">
          <button className="icon-btn" onClick={onExit} aria-label="Back to library" title="Library">
            <Icon name="back" />
          </button>
          <input className="title-input" defaultValue={title} aria-label="Study set title" onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <span className={`save-status ${status}`} aria-live="polite">
            {status === 'error' ? 'Not saved' : status === 'saved' ? 'Saved' : 'Saving…'}
          </span>
        </div>
        <div className="tb-group">
          <button className="icon-btn" onClick={() => store.undo()} disabled={!store.canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={() => store.redo()} disabled={!store.canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Icon name="redo" />
          </button>
          <details className="menu">
            <summary className="icon-btn" aria-label="Colour" title="Study set colour">
              <span className="deck-dot" style={{ background: color }} />
            </summary>
            <div className="menu-pop deck-colors">
              <div className="cover-row" role="radiogroup" aria-label="Study set colour">
                {COVERS.map((c) => (
                  <button key={c} role="radio" aria-checked={color === c} className={`cover-pick ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => recolor(c)} aria-label={`Colour ${c}`} />
                ))}
              </div>
              <label className="custom-color">
                <span>Custom</span>
                <input type="color" value={color} onChange={(e) => recolor(e.target.value)} aria-label="Custom colour" />
              </label>
            </div>
          </details>
          <details className="menu">
            <summary className="icon-btn" aria-label="Export">
              <Icon name="share" />
            </summary>
            <div className="menu-pop" onClick={(e) => (e.target as HTMLElement).closest('button') && e.currentTarget.closest('details')?.removeAttribute('open')}>
              <button onClick={() => void exportJson().catch((err: Error) => alert(`Export failed: ${err.message}`))}>Export study set (.jnotes.json)</button>
            </div>
          </details>
        </div>
      </header>

      <main className="study-scroll">
        <section className="study-hero" aria-label="Study">
          <div className="study-counts">
            <Count n={stats.due} label="Due" tone="due" />
            <Count n={stats.new} label="New" />
            <Count n={stats.learning} label="Learning" />
            <Count n={stats.mastered} label="Mastered" tone="mastered" />
          </div>
          <div className="study-actions">
            <button className="btn primary study-go" disabled={!toStudy} onClick={() => setSession('due')}>
              {toStudy ? `Study ${toStudy} ${toStudy === 1 ? 'card' : 'cards'}` : cards.length ? 'All caught up' : 'Add cards to study'}
            </button>
            <button className="btn ghost" disabled={!cards.length} onClick={() => setSession('all')} title="Go through every card; your schedule doesn't change">
              Practise all
            </button>
          </div>
          <Activity stats={stats} />
        </section>

        <section className="study-cards" aria-label="Cards">
          <div className="study-cards-head">
            <h2>
              {cards.length} {cards.length === 1 ? 'card' : 'cards'}
            </h2>
            {cards.length > 6 && <input className="search" placeholder="Search cards" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search cards" />}
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> New card
            </button>
          </div>
          {!cards.length ? (
            <div className="empty">
              <p>No cards yet.</p>
              <p className="hint">Make one here, or lasso something in a notebook and choose More › Add to study set.</p>
            </div>
          ) : (
            <ul className="card-list">
              {shown.map((c) => (
                <li key={c.id} className="card-row">
                  <button className="card-row-main" onClick={() => setEditing(c)} aria-label={`Edit card: ${sideLabel(c.front)}`}>
                    <span className="card-mini">
                      <CardFace side={c.front} docId={doc.id} label="Front" />
                    </span>
                    <span className="card-mini">
                      <CardFace side={c.back} docId={doc.id} label="Back" />
                    </span>
                  </button>
                  <div className="card-row-meta">
                    <span className={`status-chip ${cardStatus(c)}`}>{STATUS_LABEL[cardStatus(c)]}</span>
                    <span className="card-sub">{dueLabel(c, now)}</span>
                    <details className="menu">
                      <summary className="icon-btn sm" aria-label="Card actions">
                        <Icon name="more" />
                      </summary>
                      <div className="menu-pop right" onClick={(e) => (e.target as HTMLElement).closest('button') && e.currentTarget.closest('details')?.removeAttribute('open')}>
                        <button onClick={() => setEditing(c)}>Edit</button>
                        {c.source && (
                          <button
                            onClick={() => {
                              requestPageJump(c.source!.docId, c.source!.pageId);
                              location.hash = `#/n/${c.source!.docId}`;
                            }}
                          >
                            Go to notebook page
                          </button>
                        )}
                        {c.review && (
                          <button
                            onClick={() => {
                              const op = resetCardOp(store.doc, c.id);
                              if (op) store.dispatch([op]);
                            }}
                          >
                            Reset progress
                          </button>
                        )}
                        <button className="danger" onClick={() => removeCard(c)}>
                          Delete card
                        </button>
                      </div>
                    </details>
                  </div>
                </li>
              ))}
              {!shown.length && <li className="empty">No card mentions “{query}”.</li>}
            </ul>
          )}
        </section>
      </main>

      {editing && <CardEditor card={editing === 'new' ? null : editing} docId={doc.id} onCancel={() => setEditing(null)} onSave={saveCard} />}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className={`count ${tone ?? ''}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

/** The last two weeks of answers, with accuracy and the streak. */
function Activity({ stats }: { stats: ReturnType<typeof deckStats> }) {
  const max = Math.max(1, ...stats.recent.map((d) => d.reviewed));
  return (
    <div className="activity">
      <div className="activity-bars" role="img" aria-label={`Answers over the last ${stats.recent.length} days: ${stats.recent.map((d) => d.reviewed).join(', ')}`}>
        {stats.recent.map((d) => (
          <span key={d.day} className="bar" title={`${d.day}: ${d.reviewed} answered, ${d.correct} remembered`}>
            <span className="bar-fill" style={{ height: `${(d.reviewed / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <dl className="activity-facts">
        <div>
          <dt>Streak</dt>
          <dd>
            {stats.streak} {stats.streak === 1 ? 'day' : 'days'}
          </dd>
        </div>
        <div>
          <dt>Remembered</dt>
          <dd>{stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`}</dd>
        </div>
        <div>
          <dt>Answers</dt>
          <dd>{stats.reviews}</dd>
        </div>
      </dl>
    </div>
  );
}

function CardEditor({ card, docId, onCancel, onSave }: { card: StudyCard | null; docId: string; onCancel: () => void; onSave: (front: CardSide, back: CardSide) => void }) {
  const [front, setFront] = useState<CardSide>(() => card?.front ?? emptySide());
  const [back, setBack] = useState<CardSide>(() => card?.back ?? emptySide());
  const ready = !sideIsEmpty(front) && !sideIsEmpty(back);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal card-editor"
        role="dialog"
        aria-label={card ? 'Edit card' : 'New card'}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSave(front, back);
        }}
      >
        <h2>{card ? 'Edit card' : 'New card'}</h2>
        <SideEditor label="Front" side={front} docId={docId} onChange={setFront} autoFocus={!card} />
        <SideEditor label="Back" side={back} docId={docId} onChange={setBack} />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready} title={ready ? undefined : 'Both sides need something on them'}>
            {card ? 'Save' : 'Add card'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Study mode: one card at a time. Show the front, flip to the back, then say how well it was
 * remembered. Cards answered Again come round once more before the session ends.
 */
function StudyMode({ store, mode, title, color, onClose }: { store: DocumentStore; mode: StudyMode; title: string; color: string; onClose: () => void }) {
  const [queue, setQueue] = useState(() => buildSession(store.doc.cards ?? [], Date.now(), mode));
  const total = useRef(new Set(queue).size);
  const [flipped, setFlipped] = useState(false);
  // Each answer: the queue before it, so Undo can step back (the store undoes the answer itself).
  const [history, setHistory] = useState<{ queue: string[]; correct: boolean }[]>([]);
  const card = (store.doc.cards ?? []).find((c) => c.id === queue[0]);
  const scheduling = mode === 'due';
  const done = new Set(queue).size;
  const finished = !card;

  const answer = (grade: Grade) => {
    if (!card || !flipped) return;
    store.dispatch(answerOps(store.doc, card.id, grade, Date.now(), { schedule: scheduling }));
    setHistory((h) => [...h, { queue, correct: grade !== 'again' }]);
    setQueue(advance(queue, grade));
    setFlipped(false);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    store.undo();
    setHistory((h) => h.slice(0, -1));
    setQueue(last.queue);
    setFlipped(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!finished) setFlipped((f) => !f);
      } else if (flipped && /^[1-4]$/.test(e.key)) answer(GRADES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const answered = history.length;
  const remembered = history.filter((h) => h.correct).length;
  return (
    <div className="study-mode" style={{ '--deck': color } as React.CSSProperties} role="dialog" aria-label={`Studying ${title}`}>
      <header className="study-mode-head">
        <button className="icon-btn" onClick={onClose} aria-label="Stop studying" title="Stop (Esc)">
          <Icon name="close" />
        </button>
        <div className="study-progress" aria-label={`${total.current - done} of ${total.current} done`}>
          <span style={{ width: `${total.current ? ((total.current - done) / total.current) * 100 : 100}%` }} />
        </div>
        <span className="study-left">{finished ? 'Done' : `${done} left`}</span>
        <button className="icon-btn" onClick={undo} disabled={!history.length} aria-label="Undo last answer" title="Undo last answer (⌘Z)">
          <Icon name="undo" />
        </button>
      </header>

      {finished ? (
        <div className="study-done">
          <h2>{answered ? 'Session complete' : 'Nothing to study'}</h2>
          {answered > 0 && (
            <p>
              {answered} {answered === 1 ? 'answer' : 'answers'}, {Math.round((remembered / answered) * 100)}% remembered.
              {scheduling ? ' Each card will come back when it is due.' : ' Practice doesn’t change when cards are due.'}
            </p>
          )}
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the front' : 'Show the answer'}>
            <span className="flashcard-inner">
              <span className="flashcard-side front">
                <CardFace side={card.front} docId={store.doc.id} label="Front" />
              </span>
              <span className="flashcard-side back">
                <CardFace side={card.back} docId={store.doc.id} label="Back" />
              </span>
            </span>
          </button>
          <div className="study-answer" aria-live="polite">
            {flipped ? (
              <div className="grades" role="group" aria-label="How well did you remember it?">
                {GRADES.map((g, i) => (
                  <button key={g} className={`grade ${g}`} onClick={() => answer(g)} title={`${GRADE_LABEL[g]} (${i + 1})`}>
                    <strong>{GRADE_LABEL[g]}</strong>
                    {scheduling && <span>{g === 'again' ? 'again now' : intervalLabel(schedule(card.review, g, Date.now()))}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn primary show-answer" onClick={() => setFlipped(true)}>
                Show answer <kbd>Space</kbd>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
