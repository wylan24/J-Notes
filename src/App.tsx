import { useEffect, useState } from 'react';
import { Library } from './ui/Library';
import { Editor } from './ui/Editor';
import { TimerWatcher } from './ui/Timer';

// Hash routing: #/ = library, #/n/<id> = notebook. Keeps deep links working
// on any static host without server rewrites.
function parse(): string | null {
  const m = location.hash.match(/^#\/n\/([a-f0-9]+)$/);
  return m ? m[1] : null;
}

export function App() {
  const [docId, setDocId] = useState(parse);
  useEffect(() => {
    const on = () => setDocId(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <>
      {docId ? <Editor id={docId} onExit={() => (location.hash = '#/')} /> : <Library onOpen={(id) => (location.hash = `#/n/${id}`)} />}
      <TimerWatcher />
    </>
  );
}
