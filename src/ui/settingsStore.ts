// The writing and page settings the Settings screen gathers. In a notebook the editor holds them
// (and saves each under its own key, as before); from the library they are read and written here.
import type { ScrollDirection } from '../core/model';
import { normaliseStabilise } from '../core/stabilise';

export type InkToolName = 'pen' | 'highlighter' | 'shapes';

export interface EditorSettings {
  /** Only a stylus draws; fingers scroll. */
  penOnly: boolean;
  /** Scribbling over ink with the pen rubs it out. */
  scribbleErase: boolean;
  /** Dragged selections line up with other things. */
  snap: boolean;
  scroll: ScrollDirection;
  /** The highlighter draws straight lines. */
  straightHighlighter: boolean;
  /** How much each ink tool steadies the line, 0..1. */
  stabilise: Record<InkToolName, number>;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered.
  }
}

type StoredInk = Partial<Record<InkToolName, { stabilise?: unknown; straight?: unknown }>>;

export function storedSettings(): EditorSettings {
  const ink = read<StoredInk>('jnotes.ink', {});
  return {
    penOnly: read<unknown>('jnotes.penOnly', false) === true,
    scribbleErase: read<unknown>('jnotes.scribbleErase', true) !== false,
    snap: read<unknown>('jnotes.snap', true) !== false,
    scroll: read<string>('jnotes.scroll', 'vertical') === 'horizontal' ? 'horizontal' : 'vertical',
    straightHighlighter: ink.highlighter?.straight === true,
    stabilise: {
      pen: normaliseStabilise(ink.pen?.stabilise),
      highlighter: normaliseStabilise(ink.highlighter?.stabilise),
      shapes: normaliseStabilise(ink.shapes?.stabilise),
    },
  };
}

/** Save changed settings, under the keys the notebook editor reads when it opens. */
export function storeSettings(patch: Partial<EditorSettings>): void {
  if (patch.penOnly !== undefined) write('jnotes.penOnly', patch.penOnly);
  if (patch.scribbleErase !== undefined) write('jnotes.scribbleErase', patch.scribbleErase);
  if (patch.snap !== undefined) write('jnotes.snap', patch.snap);
  if (patch.scroll !== undefined) write('jnotes.scroll', patch.scroll);
  if (patch.straightHighlighter !== undefined || patch.stabilise) {
    const ink = read<Record<string, Record<string, unknown>>>('jnotes.ink', {});
    const next = { ...ink };
    if (patch.straightHighlighter !== undefined) next.highlighter = { ...next.highlighter, straight: patch.straightHighlighter };
    for (const [tool, v] of Object.entries(patch.stabilise ?? {})) next[tool] = { ...next[tool], stabilise: v };
    write('jnotes.ink', next);
  }
}
