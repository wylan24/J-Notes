import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';
import { applyTheme } from './ui/theme';
import { setUpPwa } from './pwa/register';
import { completeSignIn } from './auth/google';
import { setUpSync } from './sync';

// Light or dark as chosen, before anything is drawn.
applyTheme();
// Coming back from Google's sign-in page: read the result out of the address before routing.
completeSignIn();
// Drive sync, when signed in.
setUpSync();
// Offline support, updates and the install prompt.
setUpPwa();

// Ask the browser not to evict our IndexedDB data under storage pressure.
void navigator.storage?.persist?.();

// Discard data left by the app's pre-rename build ("inkwell"). Safe to remove later.
try {
  indexedDB.deleteDatabase('inkwell');
  for (const k of ['zoom', 'ink', 'penOnly']) localStorage.removeItem(`inkwell.${k}`);
} catch {
  /* storage unavailable (private mode etc.) */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
