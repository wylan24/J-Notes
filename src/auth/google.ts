// The signed-in Google account: starting sign-in, finishing it when Google sends the person back,
// and signing out. Signing in or out never touches notebooks; signed out, the app is unchanged.
//
// What is kept where:
// - who is signed in (no access) — localStorage, so it survives reloads and restarts;
// - the hour-long Drive access token — sessionStorage, so it never outlives the tab;
// - a sign-in in progress (state and nonce) — localStorage, for the trip to Google and back.
import { useSyncExternalStore } from 'react';
import {
  authUrl,
  isAuthRedirect,
  normaliseAccount,
  normalisePending,
  normaliseToken,
  readRedirect,
  tokenValid,
  type AccessToken,
  type Account,
} from '../core/account';

const ACCOUNT_KEY = 'jnotes.account';
const TOKEN_KEY = 'jnotes.googleToken';
const PENDING_KEY = 'jnotes.signIn';

/** The OAuth client for this build; set VITE_GOOGLE_CLIENT_ID (see README). Not a secret. */
export const clientId: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

export interface AccountState {
  account: Account | null;
  /** What went wrong with the last sign-in, until it is dismissed. */
  error: string | null;
}

function read(storage: () => Storage, key: string): unknown {
  try {
    const v = storage().getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value == null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered: the person stays signed in until the page closes.
  }
}
const local = () => localStorage;
const session = () => sessionStorage;

let state: AccountState = { account: null, error: null };
let token: AccessToken | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  state = { account: normaliseAccount(read(local, ACCOUNT_KEY)), error: null };
  token = state.account ? normaliseToken(read(session, TOKEN_KEY)) : null;
}
function set(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (load(), state),
  );
}

/** A Drive access token that is good for at least another minute, or null (sync renews it). */
export function accessToken(): AccessToken | null {
  load();
  return tokenValid(token, Date.now()) ? token : null;
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Where Google sends the person back: the app's own address (registered with the OAuth client). */
const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`;

/** Go to Google to sign in. The page leaves; edits are already saved by then. */
export function signIn(): void {
  if (!clientId) return;
  const pending = { state: randomId(), nonce: randomId(), returnTo: location.hash.startsWith('#/') ? location.hash : '#/', startedAt: Date.now() };
  write(local, PENDING_KEY, pending);
  location.assign(authUrl({ clientId, redirectUri: redirectUri(), state: pending.state, nonce: pending.nonce, loginHint: state.account?.email }));
}

/**
 * If Google just sent the person back, take the sign-in out of the address (so it is neither
 * shown nor bookmarked) and return to where they were. Runs before the app reads its route.
 */
export function completeSignIn(): void {
  if (!isAuthRedirect(location.hash)) return;
  load();
  const result = readRedirect(location.hash, normalisePending(read(local, PENDING_KEY)), clientId, Date.now());
  write(local, PENDING_KEY, null);
  history.replaceState(null, '', `${location.pathname}${location.search}${result.returnTo}`);
  if (result.kind === 'error') {
    set({ error: result.message });
    return;
  }
  token = result.token;
  write(local, ACCOUNT_KEY, result.account);
  write(session, TOKEN_KEY, result.token);
  set({ account: result.account, error: null });
}

/** Forget the account and give back Drive access. Notebooks on this device are left as they are. */
export function signOut(): void {
  load();
  if (token) {
    // Best effort: the grant also lapses with the token within the hour.
    void fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token.token }),
    }).catch(() => {});
  }
  token = null;
  write(local, ACCOUNT_KEY, null);
  write(session, TOKEN_KEY, null);
  set({ account: null, error: null });
}

export const dismissSignInError = (): void => set({ error: null });
