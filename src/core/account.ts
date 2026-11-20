// Signing in with Google, with no backend: the browser goes to Google's sign-in page and comes
// back with an access token (for Drive, used by sync) and an ID token (who signed in) in the URL
// fragment. A redirect rather than a popup, because popups are unreliable in an app installed on
// the iPad's home screen. Pure, so it is tested in Node; src/auth/google.ts does the browser part.

/** Only the app's own hidden Drive folder, never the rest of the person's Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPES = ['openid', 'email', 'profile', DRIVE_SCOPE] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Who is signed in. Kept between visits; holds nothing that grants access. */
export interface Account {
  /** Google's stable id for the person. */
  id: string;
  email: string;
  name: string;
  picture?: string;
}

/** Access to Drive. Lasts an hour; never kept beyond the browser tab. */
export interface AccessToken {
  token: string;
  /** ms since the epoch. */
  expiresAt: number;
  scopes: string[];
}

/** A sign-in that has been started, kept until Google sends the person back. */
export interface PendingSignIn {
  state: string;
  nonce: string;
  /** Where in the app to go back to, e.g. "#/n/abc". */
  returnTo: string;
  startedAt: number;
}

/** How long a started sign-in stays valid. */
export const PENDING_TTL_MS = 10 * 60_000;

export function authUrl(o: { clientId: string; redirectUri: string; state: string; nonce: string; loginHint?: string; silent?: boolean }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'token id_token',
    scope: SCOPES.join(' '),
    state: o.state,
    nonce: o.nonce,
    include_granted_scopes: 'true',
  });
  if (o.loginHint) p.set('login_hint', o.loginHint);
  // Silent: no screens at all; Google sends back an error if it needs to ask anything.
  if (o.silent) p.set('prompt', 'none');
  return `${AUTH_ENDPOINT}?${p}`;
}

export type RedirectResult =
  | { kind: 'signed-in'; account: Account; token: AccessToken; returnTo: string }
  | { kind: 'error'; message: string; returnTo: string };

/** Is this URL fragment Google sending someone back? (Then it isn't an app route.) */
export function isAuthRedirect(hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  return p.has('state') && (p.has('access_token') || p.has('error'));
}

/** What a JWT says about itself. Not verified: only shown to the person, never trusted by a server. */
export function jwtClaims(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  interaction_required: 'Google needs you to sign in again.',
  login_required: 'Google needs you to sign in again.',
  consent_required: 'Google needs you to sign in again.',
};

/**
 * Read what Google sent back, checking it answers the sign-in this browser started (state), was
 * issued for this app (audience) and this sign-in (nonce), and hasn't expired.
 */
export function readRedirect(hash: string, pending: PendingSignIn | null, clientId: string, now: number): RedirectResult {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const fail = (message: string): RedirectResult => ({ kind: 'error', message, returnTo: pending?.returnTo ?? '#/' });
  if (!pending || p.get('state') !== pending.state || now - pending.startedAt > PENDING_TTL_MS) {
    return { kind: 'error', message: 'That sign-in had expired or was not started here. Please try again.', returnTo: '#/' };
  }
  const error = p.get('error');
  if (error) return fail(ERRORS[error] ?? `Google could not sign you in (${error}).`);

  const token = p.get('access_token');
  const idToken = p.get('id_token');
  const expiresIn = Number(p.get('expires_in'));
  if (!token || !idToken || !(expiresIn > 0)) return fail('Google sent back an incomplete sign-in. Please try again.');

  const c = jwtClaims(idToken);
  const aud = c?.aud;
  if (
    !c ||
    !ISSUERS.has(String(c.iss)) ||
    (Array.isArray(aud) ? !aud.includes(clientId) : aud !== clientId) ||
    c.nonce !== pending.nonce ||
    !(typeof c.exp === 'number' && c.exp * 1000 > now) ||
    typeof c.sub !== 'string' ||
    typeof c.email !== 'string'
  ) {
    return fail('Google sent back a sign-in for something else. Please try again.');
  }
  const account: Account = {
    id: c.sub,
    email: c.email,
    name: typeof c.name === 'string' && c.name ? c.name : c.email,
    ...(typeof c.picture === 'string' && /^https:\/\//.test(c.picture) ? { picture: c.picture } : {}),
  };
  return {
    kind: 'signed-in',
    account,
    token: { token, expiresAt: now + expiresIn * 1000, scopes: (p.get('scope') ?? '').split(/\s+/).filter(Boolean) },
    returnTo: pending.returnTo,
  };
}

/** Still usable for at least another minute. */
export const tokenValid = (t: AccessToken | null, now: number): t is AccessToken => !!t && t.expiresAt - now > 60_000;

/** The person may untick Drive on Google's consent screen; sign-in still works, sync doesn't. */
export const canUseDrive = (t: AccessToken | null): boolean => !!t?.scopes.includes(DRIVE_SCOPE);

/** A stored account, or null if it is missing or not one. */
export function normaliseAccount(v: unknown): Account | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !a.id || typeof a.email !== 'string') return null;
  return {
    id: a.id,
    email: a.email,
    name: typeof a.name === 'string' && a.name ? a.name : a.email,
    ...(typeof a.picture === 'string' && /^https:\/\//.test(a.picture) ? { picture: a.picture } : {}),
  };
}

export function normaliseToken(v: unknown): AccessToken | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (typeof t.token !== 'string' || typeof t.expiresAt !== 'number' || !Array.isArray(t.scopes)) return null;
  return { token: t.token, expiresAt: t.expiresAt, scopes: t.scopes.filter((s): s is string => typeof s === 'string') };
}

export function normalisePending(v: unknown): PendingSignIn | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.state !== 'string' || typeof p.nonce !== 'string' || typeof p.startedAt !== 'number') return null;
  return { state: p.state, nonce: p.nonce, startedAt: p.startedAt, returnTo: typeof p.returnTo === 'string' && p.returnTo.startsWith('#/') ? p.returnTo : '#/' };
}
