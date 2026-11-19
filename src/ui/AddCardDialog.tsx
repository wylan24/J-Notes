// Make a flashcard from a lasso selection: the selection is the front (or the back), the other side
// is typed, drawn, or lassoed next. The card goes into a study set that isn't open, with copies of
// the photos it shows.
import { useEffect, useState } from 'react';
import type { CardSide, NotebookMeta } from '../core/model';
import { docKind } from '../core/model';
import { cardBlobIds, newCard, sideIsEmpty } from '../core/study';
import { newId } from '../core/ids';
import { appendCards, createNotebook, getBlobs, listNotebooks } from '../storage/db';
import { COVERS } from './CoverPicker';
import { SideEditor } from './CardFace';

/** A card being made from a notebook: its sides so far, and the page it came from. */
export interface CardDraft {
  front: CardSide;
  back: CardSide;
  source: { docId: string; pageId: string };
}

const LAST_DECK = 'jnotes.lastDeck';
const NEW_DECK = '';

function lastDeck(): string | null {
  try {
    return localStorage.getItem(LAST_DECK);
  } catch {
    return null;
  }
}

export function AddCardDialog({
  draft,
  onChange,
  onPickBack,
  onDone,
  onCancel,
}: {
  draft: CardDraft;
  onChange: (d: CardDraft) => void;
  /** Close the dialog to lasso the back on the page. */
  onPickBack: () => void;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [decks, setDecks] = useState<NotebookMeta[] | null>(null);
  const [deckId, setDeckId] = useState<string>(NEW_DECK);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // Swapping remounts the side editors so each starts from its new content.
  const [swaps, setSwaps] = useState(0);
  const docId = draft.source.docId;

  useEffect(() => {
    void listNotebooks().then((all) => {
      const list = all.filter((m) => docKind(m) === 'deck' && m.trashedAt === null && !m.lock);
      setDecks(list);
      const last = lastDeck();
      setDeckId(list.find((m) => m.id === last)?.id ?? list[0]?.id ?? NEW_DECK);
    });
  }, []);

  const ready = !sideIsEmpty(draft.front) && !sideIsEmpty(draft.back) && decks !== null;

  const add = async () => {
    setBusy(true);
    try {
      const card = newCard(draft.front, draft.back, Date.now(), draft.source);
      const blobs = (await getBlobs(docId, cardBlobIds(card))).map(({ id, type, bytes }) => ({ id, type, bytes }));
      let target = deckId;
      let name = decks?.find((m) => m.id === deckId)?.title ?? '';
      if (target === NEW_DECK) {
        target = newId();
        name = newName.trim() || 'Untitled study set';
        const now = Date.now();
        await createNotebook(
          { id: target, kind: 'deck', title: name, cover: COVERS[2], template: 'blank', createdAt: now, updatedAt: now, favourite: false, trashedAt: null, pageCount: 0, deck: { cards: 1, due: [0] } },
          { id: target, pages: [], cards: [card] },
          blobs.map((b) => ({ docId: target, ...b })),
        );
      } else await appendCards(target, [card], blobs);
      try {
        localStorage.setItem(LAST_DECK, target);
      } catch {
        // Not remembered.
      }
      onDone(`Added a card to “${name}”`);
    } catch (e) {
      alert(`Could not add the card: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal card-editor"
        role="dialog"
        aria-label="Add to study set"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void add();
        }}
      >
        <h2>Add to study set</h2>
        {/* Pictures can't be added here: they would be stored in the notebook rather than the study set. */}
        <SideEditor key={`f${swaps}`} label="Front" side={draft.front} docId={docId} onChange={(front) => onChange({ ...draft, front })} pictures={false} />
        <SideEditor key={`b${swaps}`} label="Back" side={draft.back} docId={docId} onChange={(back) => onChange({ ...draft, back })} pictures={false} autoFocus={sideIsEmpty(draft.back)} />
        <div className="pad-tools">
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              onChange({ ...draft, front: draft.back, back: draft.front });
              setSwaps((n) => n + 1);
            }}
          >
            ⇅ Swap sides
          </button>
          <button type="button" className="btn sm ghost" onClick={onPickBack} title="Close this, lasso the answer on the page, then choose Use as card back">
            Lasso the back instead
          </button>
        </div>
        <label className="field">
          <span>Study set</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={decks === null}>
            {(decks ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
            <option value={NEW_DECK}>New study set…</option>
          </select>
        </label>
        {deckId === NEW_DECK && (
          <label className="field">
            <span>Name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Untitled study set" />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready || busy} title={ready ? undefined : 'Both sides need something on them'}>
            {busy ? 'Adding…' : 'Add card'}
          </button>
        </div>
      </form>
    </div>
  );
}
