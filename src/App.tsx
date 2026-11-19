import { useEffect, useState } from 'react';
import { Library } from './ui/Library';
import { Editor } from './ui/Editor';
import { TimerWatcher } from './ui/Timer';
import { Presentation } from './ui/Presentation';
import { openTab } from './ui/tabsStore';
import { usePwa } from './pwa/register';

/** Shown when a new version has been downloaded: it takes over only when the person chooses. */
function UpdateBanner() {
  const { update } = usePwa();
  if (!update) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of J Notes is ready.</span>
      <button className="btn sm primary" onClick={update}>
        Reload
      </button>
    </div>
  );
}

// Hash routing: #/ = library, #/n/<id> = notebook, #/present/<id> = presentation window.
// Keeps deep links working on any static host without server rewrites.
function parse(): string | null {
  const m = location.hash.match(/^#\/n\/([a-f0-9]+)$/);
  return m ? m[1] : null;
}

const presenting = location.hash.match(/^#\/present\/([a-f0-9]+)$/)?.[1] ?? null;

export function App() {
  // The audience window shows only the presentation.
  if (presenting) return <Presentation docId={presenting} />;
  return <MainApp />;
}

function MainApp() {
  const [docId, setDocId] = useState(parse);
  useEffect(() => {
    const on = () => setDocId(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Keyed by notebook: switching tabs starts a fresh editor rather than reusing one mid-load.
  // Any notebook that is open has a tab, however it was opened (library, link, reload).
  useEffect(() => {
    if (docId) openTab(docId);
  }, [docId]);

  return (
    <>
      {docId ? <Editor key={docId} id={docId} onExit={() => (location.hash = '#/')} /> : <Library onOpen={(id) => (location.hash = `#/n/${id}`)} />}
      <TimerWatcher />
      <UpdateBanner />
    </>
  );
}
