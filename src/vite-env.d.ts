/// <reference types="vite/client" />

// nspell ships without types; just what spellcheck uses.
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }
  export default function nspell(aff: string, dic: string): NSpell;
}
