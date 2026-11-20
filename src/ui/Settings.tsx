import { useEffect, useState, useSyncExternalStore } from 'react';
import { forPlatform, SHORTCUT_GROUPS } from '../core/shortcuts';
import { setTheme, useTheme, type Theme } from './theme';
import { isIos, isStandalone, usePwa } from '../pwa/register';
import type { EditorSettings, InkToolName } from './settingsStore';
import { setHandwritingEnabled, useHandwritingEnabled } from '../hwr/indexer';
import { onRecognizerStatus, recognizerStatus, startRecognizer, stop as stopRecognizer } from '../hwr/recognizer';
import { setSpellcheckEnabled, useSpellcheckEnabled } from '../hwr/spellcheck';
import { clientId, dismissSignInError, signIn, signOut, useAccount } from '../auth/google';
import { syncNow, useSyncStatus, type SyncStatus } from '../sync';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
const INK_LABELS: Record<InkToolName, string> = { pen: 'Pen', highlighter: 'Highlighter', shapes: 'Shapes' };

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);

/** Close on Escape. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row">
      <span>
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button type="button" key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `at ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

const SYNC_SCOPE = 'Notebooks, folders, elements and preferences sync with your Google Drive; stylus, theme and handwriting settings stay per device.';

/** How syncing is going, and what to do about it. */
function SyncLine({ status }: { status: SyncStatus }) {
  const [message, action] = ((): [string, { label: string; run: () => void } | null] => {
    switch (status.state) {
      case 'syncing':
        return ['Syncing with Google Drive…', null];
      case 'offline':
        return ["Offline. Changes sync when you're back online.", null];
      case 'reconnect':
        return ['Sync is paused: Google Drive access lasts an hour. Reconnect to carry on.', { label: 'Reconnect', run: signIn }];
      case 'no-drive':
        return ["J Notes wasn't allowed to use its Google Drive folder, so it can't sync. Sign in again and allow it.", { label: 'Sign in again', run: signIn }];
      case 'error':
        return [`Couldn't sync. ${status.error ?? ''}`, { label: 'Try again', run: () => syncNow() }];
      case 'idle':
        return [
          status.lastSynced ? `Synced with your Google Drive ${ago(status.lastSynced)}. Notebooks, folders, elements and preferences sync; stylus, theme and handwriting settings stay per device.` : SYNC_SCOPE,
          { label: 'Sync now', run: () => syncNow() },
        ];
      default:
        return [SYNC_SCOPE, { label: 'Sync now', run: () => syncNow() }];
    }
  })();
  return (
    <div className="setting-row">
      <span className={`setting-hint${status.state === 'error' || status.state === 'no-drive' ? ' danger-text' : ''}`} role="status">
        {message}
      </span>
      {action && (
        <button type="button" className="btn sm" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Signing in with Google: optional, and it never changes what is on this device. */
function AccountSection() {
  const { account, error } = useAccount();
  const sync = useSyncStatus();
  const [pictureFailed, setPictureFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <section>
      <h3>Account</h3>
      {error && (
        <p className="setting-hint danger-text" role="alert">
          {error}{' '}
          <button type="button" className="btn sm ghost" onClick={dismissSignInError}>
            Dismiss
          </button>
        </p>
      )}
      {account ? (
        <>
          <div className="setting-row">
            <span className="account">
              {account.picture && !pictureFailed ? (
                <img className="account-avatar" src={account.picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} />
              ) : (
                <span className="account-avatar" aria-hidden="true">
                  {account.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span>
                <span className="setting-label">{account.name}</span>
                <span className="setting-hint">{account.email}</span>
              </span>
            </span>
            {confirming ? (
              <span className="account-actions">
                <button type="button" className="btn sm ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => {
                    signOut();
                    setConfirming(false);
                  }}
                >
                  Sign out
                </button>
              </span>
            ) : (
              <button type="button" className="btn sm" onClick={() => setConfirming(true)}>
                Sign out
              </button>
            )}
          </div>
          {confirming ? <p className="setting-hint">Your notebooks stay on this device after you sign out.</p> : <SyncLine status={sync} />}
        </>
      ) : clientId ? (
        <div className="setting-row">
          <span>
            <span className="setting-label">Sign in with Google</span>
            <span className="setting-hint">Optional. J Notes works fully without an account; signed in, your notebooks sync between devices through your own Google Drive.</span>
          </span>
          <button type="button" className="btn sm primary" onClick={signIn} disabled={!navigator.onLine}>
            Sign in
          </button>
        </div>
      ) : (
        <p className="setting-hint">Google sign-in isn't set up in this build of J Notes.</p>
      )}
    </section>
  );
}

/** Installing the app: a button where the browser offers it, otherwise how to do it. */
function AppSection() {
  const { install } = usePwa();
  const standalone = isStandalone();
  return (
    <section>
      <h3>App</h3>
      {standalone ? (
        <p className="setting-hint">Installed. J Notes opens on its own and works without a connection.</p>
      ) : install ? (
        <div className="setting-row">
          <span>
            <span className="setting-label">Install J Notes</span>
            <span className="setting-hint">Open it from your home screen or dock, and use it offline.</span>
          </span>
          <button type="button" className="btn sm primary" onClick={() => void install()}>
            Install
          </button>
        </div>
      ) : (
        <p className="setting-hint">
          {isIos()
            ? 'To install J Notes, tap Share in Safari, then Add to Home Screen. It then works offline.'
            : "To install J Notes, use your browser's Install app option. Once loaded, it works offline either way."}
        </p>
      )}
    </section>
  );
}

/**
 * Handwriting recognition: off until chosen, since the model is a large download. Turning it on
 * starts the download here, with its progress, so it isn't a surprise later.
 */
function HandwritingSection() {
  const on = useHandwritingEnabled();
  const status = useSyncExternalStore(onRecognizerStatus, recognizerStatus);
  const spell = useSpellcheckEnabled();
  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  return (
    <section>
      <h3>Handwriting</h3>
      <Toggle
        label="Recognise handwriting"
        hint="Makes your writing searchable, here and in the library. Reading happens on this device; the reading model is a one-time download of about 70 MB."
        checked={on}
        onChange={(v) => {
          setHandwritingEnabled(v);
          if (v) void startRecognizer().catch(() => {});
          else stopRecognizer();
        }}
      />
      {on && (
        <p className="setting-hint" aria-live="polite">
          {status.state === 'loading'
            ? status.total
              ? `Downloading the reading model: ${mb(status.loaded)} of ${mb(status.total)}…`
              : 'Starting the reading model…'
            : status.state === 'ready'
              ? 'Ready. New writing is read a moment after you stop writing.'
              : status.state === 'error'
                ? status.message
                : 'Writing is read in the background while a notebook is open.'}
          {status.state === 'error' && (
            <>
              {' '}
              <button type="button" className="btn sm ghost" onClick={() => void startRecognizer().catch(() => {})}>
                Try again
              </button>
            </>
          )}
        </p>
      )}
      {on && (
        <Toggle
          label="Check spelling"
          hint="Underlines handwritten words the English dictionary doesn’t know. With the lasso, tap one to swap it for a suggestion. Misread words can be underlined too."
          checked={spell}
          onChange={setSpellcheckEnabled}
        />
      )}
    </section>
  );
}

/** How much this browser is storing for the app, and how much it may. */
function StorageUse() {
  const [use, setUse] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]).then(([e, persisted]) => {
      if (e?.usage !== undefined && e.quota) setUse({ used: e.usage, quota: e.quota, persisted: !!persisted });
    });
  }, []);
  if (!use) return null;
  const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);
  return (
    <p className="setting-hint">
      Using {mb(use.used)} of the {mb(use.quota)} this browser allows.{' '}
      {use.persisted ? 'The browser will keep it even when space runs low.' : 'The browser may clear it if space runs very low.'}
    </p>
  );
}

interface Props {
  values: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
  onClose: () => void;
  /** Hide settings that a whiteboard has no use for. */
  board?: boolean;
}

/** Every preference in one place: appearance, writing, pages, and the keyboard shortcuts. */
export function SettingsDialog({ values, onChange, onClose, board }: Props) {
  const theme = useTheme();
  const [shortcuts, setShortcuts] = useState(false);
  useEscape(onClose);
  if (shortcuts) return <ShortcutsSheet onClose={() => setShortcuts(false)} />;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <AccountSection />
        <section>
          <h3>Appearance</h3>
          <Choice label="Theme" options={THEMES} value={theme} onChange={setTheme} />
          <p className="setting-hint">On dark paper, dark ink shows lighter on screen; exports keep its real colours.</p>
        </section>
        <section>
          <h3>Writing</h3>
          <Toggle label="Stylus only" hint="Fingers scroll and zoom; only a stylus draws." checked={values.penOnly} onChange={(penOnly) => onChange({ penOnly })} />
          <Toggle label="Scribble to erase" hint="Scribbling over ink with the pen rubs it out." checked={values.scribbleErase} onChange={(scribbleErase) => onChange({ scribbleErase })} />
          <Toggle label="Straight highlighter" hint="The highlighter draws straight lines." checked={values.straightHighlighter} onChange={(straightHighlighter) => onChange({ straightHighlighter })} />
          {(Object.keys(INK_LABELS) as InkToolName[]).map((t) => (
            <label key={t} className="setting-row">
              <span className="setting-label">{INK_LABELS[t]} stabilisation</span>
              <span className="setting-range">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(values.stabilise[t] * 100)}
                  aria-label={`${INK_LABELS[t]} stabilisation`}
                  onChange={(e) => onChange({ stabilise: { ...values.stabilise, [t]: Number(e.target.value) / 100 } })}
                />
                <output>{Math.round(values.stabilise[t] * 100)}%</output>
              </span>
            </label>
          ))}
        </section>
        <section>
          <h3>Objects and pages</h3>
          <Toggle label="Snap when moving" hint="Selections line up with other objects, the page and its lines." checked={values.snap} onChange={(snap) => onChange({ snap })} />
          {!board && (
            <Choice
              label="Pages scroll"
              options={[
                { id: 'vertical', label: 'Up and down' },
                { id: 'horizontal', label: 'Sideways' },
              ]}
              value={values.scroll}
              onChange={(scroll) => onChange({ scroll })}
            />
          )}
        </section>
        <HandwritingSection />
        <AppSection />
        <section>
          <h3>Storage</h3>
          <p className="setting-hint">Everything is kept on this device, in this browser.</p>
          <StorageUse />
        </section>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setShortcuts(true)}>
            Keyboard shortcuts
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every keyboard shortcut, grouped, with keys shown for this platform. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const mac = isMac();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.items.map((s) => (
                  <div key={s.keys + s.does} className="shortcut">
                    <dt>
                      <kbd>{forPlatform(s.keys, mac)}</kbd>
                    </dt>
                    <dd>{s.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
