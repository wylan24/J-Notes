/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client for sign-in (public, not a secret). Unset: sign-in is hidden. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

// nspell ships without types; just what spellcheck uses.
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }
  export default function nspell(aff: string, dic: string): NSpell;
}
