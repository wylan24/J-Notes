// Spellcheck for recognised handwriting: the setting, the person's own words, and an English
// Hunspell dictionary (dictionary-en, from SCOWL; MIT and BSD) read by nspell (MIT). The
// dictionary (about 550 KB) is fetched and parsed only once spellcheck is turned on.
import { useEffect, useState, useSyncExternalStore } from 'react';
// By path: the package only exports its Node entry, which reads these files from disk.
import affUrl from '../../node_modules/dictionary-en/index.aff?url';
import dicUrl from '../../node_modules/dictionary-en/index.dic?url';

const KEY = 'jnotes.spell';
const WORDS_KEY = 'jnotes.spell.words';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

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
    // Not remembered, but applies until the app is closed.
  }
}

export const spellcheckEnabled = (): boolean => read<unknown>(KEY, false) === true;

export function setSpellcheckEnabled(on: boolean): void {
  write(KEY, on);
  notify();
}

export const useSpellcheckEnabled = (): boolean => useSyncExternalStore(subscribe, spellcheckEnabled);

// Words the person added with "Add to dictionary", kept in this browser.
let personal: Set<string> | null = null;
const personalWords = () => (personal ??= new Set(read<string[]>(WORDS_KEY, [])));

export function addPersonalWord(word: string): void {
  personalWords().add(word.toLowerCase());
  write(WORDS_KEY, [...personalWords()]);
  version++;
  notify();
}

export interface SpellChecker {
  correct(word: string): boolean;
  suggest(word: string): string[];
  /** Changes when the person's own words do, so marks are found again. */
  version: number;
}

let version = 0;
interface NSpell {
  correct(word: string): boolean;
  suggest(word: string): string[];
}
let loading: Promise<NSpell> | null = null;

function loadDictionary(): Promise<NSpell> {
  loading ??= (async () => {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import('nspell'),
      fetch(affUrl).then((r) => r.text()),
      fetch(dicUrl).then((r) => r.text()),
    ]);
    return nspell(aff, dic) as NSpell;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** The spellchecker while spellcheck is on and the dictionary has loaded; null otherwise. */
export function useSpellChecker(): SpellChecker | null {
  const on = useSpellcheckEnabled();
  const [dict, setDict] = useState<NSpell | null>(null);
  const v = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!on) return setDict(null);
    let live = true;
    loadDictionary().then(
      (d) => live && setDict(d),
      (e) => console.error('Could not load the dictionary', e),
    );
    return () => {
      live = false;
    };
  }, [on]);
  const [checker, setChecker] = useState<SpellChecker | null>(null);
  useEffect(() => {
    if (!dict) return setChecker(null);
    const mine = personalWords();
    setChecker({
      // A word is right as written, or in lower case (a capital starting a sentence), or one of the person's own.
      correct: (w) => mine.has(w.toLowerCase()) || dict.correct(w) || dict.correct(w.toLowerCase()),
      suggest: (w) => dict.suggest(w),
      version: v,
    });
  }, [dict, v]);
  return checker;
}
