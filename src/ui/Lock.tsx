import { useState } from 'react';
import { createPortal } from 'react-dom';
import { checkPassword, createLock, passwordProblem, subtleCrypto } from '../core/lock';
import type { NotebookLock, NotebookMeta } from '../core/model';
import { Icon } from './icons';

/** Said wherever a lock is set up or opened, so nobody mistakes it for encryption. */
export const NOT_ENCRYPTION =
  'A password lock hides this notebook behind a lock screen in J Notes. It does not encrypt it: someone with access to this browser’s data on this device could still read it.';

/** Shown instead of the editor until the notebook's password is entered. */
export function LockScreen({ meta, onUnlock, onExit }: { meta: NotebookMeta; onUnlock: () => void; onExit: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const subtle = subtleCrypto();
  const lock = meta.lock!;

  const submit = async () => {
    if (!subtle || !password) return;
    setBusy(true);
    setError(null);
    try {
      if (await checkPassword(subtle, lock, password)) onUnlock();
      else {
        setError('That password isn’t right.');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <form
        className="lock-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="lock-icon">
          <Icon name="lock" />
        </span>
        <h2>{meta.title}</h2>
        <p className="muted">This notebook is locked.</p>
        {subtle ? (
          <>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              aria-invalid={!!error}
              disabled={busy}
            />
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn primary" disabled={!password || busy}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            {lock.hint &&
              (showHint ? (
                <p className="lock-hint">Hint: {lock.hint}</p>
              ) : (
                <button type="button" className="link-btn" onClick={() => setShowHint(true)}>
                  Show hint
                </button>
              ))}
          </>
        ) : (
          <p className="field-error">Unlocking needs a secure connection. Open J Notes over https (or on this device as localhost).</p>
        )}
        <button type="button" className="btn ghost" onClick={onExit}>
          Back to library
        </button>
        <p className="lock-note">{NOT_ENCRYPTION}</p>
      </form>
    </div>
  );
}

type Mode = 'set' | 'change' | 'remove';

/** Add, change or remove a notebook's password. Changing or removing needs the current one. */
export function LockDialog({
  lock,
  mode,
  onCancel,
  onDone,
}: {
  lock: NotebookLock | undefined;
  mode: Mode;
  onCancel: () => void;
  /** The new lock, or undefined when it was removed. */
  onDone: (lock: NotebookLock | undefined) => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState(lock?.hint ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subtle = subtleCrypto();
  const needsCurrent = mode !== 'set';
  const needsNew = mode !== 'remove';
  const title = mode === 'set' ? 'Lock with a password' : mode === 'change' ? 'Change password' : 'Remove lock';

  const submit = async () => {
    if (!subtle) return;
    if (needsNew) {
      const problem = passwordProblem(password, confirm);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError(null);
    try {
      if (needsCurrent && lock && !(await checkPassword(subtle, lock, current))) {
        setError('The current password isn’t right.');
        return;
      }
      onDone(needsNew ? await createLock(subtle, password, hint) : undefined);
    } finally {
      setBusy(false);
    }
  };

  // Rendered into <body>: it opens from inside another dialog's form, and forms can't nest.
  // Clicks stop here so they don't reach the dialog underneath.
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{title}</h2>
        {!subtle && <p className="field-error">Password locks need a secure connection. Open J Notes over https (or on this device as localhost).</p>}
        {needsCurrent && (
          <label className="field">
            <span>Current password</span>
            <input type="password" autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} />
          </label>
        )}
        {needsNew && (
          <>
            <label className="field">
              <span>{mode === 'change' ? 'New password' : 'Password'}</span>
              <input type="password" autoFocus={!needsCurrent} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
            </label>
            <label className="field">
              <span>Hint (optional)</span>
              <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Shown on the lock screen" disabled={busy} />
            </label>
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <p className="lock-note">
          {NOT_ENCRYPTION} {needsNew && 'If you forget the password, J Notes can’t open the notebook for you.'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${mode === 'remove' ? 'danger' : 'primary'}`} disabled={!subtle || busy}>
            {busy ? 'Working…' : mode === 'remove' ? 'Remove lock' : mode === 'change' ? 'Change password' : 'Lock notebook'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** The lock controls in the Edit notebook dialog. */
export function LockSection({ lock, onChange }: { lock: NotebookLock | undefined; onChange: (lock: NotebookLock | undefined) => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <fieldset className="field">
      <legend>Password lock</legend>
      <div className="cover-image-row">
        {lock ? (
          <>
            <span className="lock-status">
              <Icon name="lock" /> Locked
            </span>
            <button type="button" className="btn sm ghost" onClick={() => setMode('change')}>
              Change password…
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setMode('remove')}>
              Remove lock…
            </button>
          </>
        ) : (
          <button type="button" className="btn sm ghost" onClick={() => setMode('set')}>
            <Icon name="lock" /> Lock with a password…
          </button>
        )}
      </div>
      {mode && (
        <LockDialog
          lock={lock}
          mode={mode}
          onCancel={() => setMode(null)}
          onDone={(l) => {
            setMode(null);
            onChange(l);
          }}
        />
      )}
    </fieldset>
  );
}
