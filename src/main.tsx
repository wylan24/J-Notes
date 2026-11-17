import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';

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
