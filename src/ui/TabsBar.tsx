import { useEffect, useState } from 'react';
import type { NotebookMeta } from '../core/model';
import { listNotebooks } from '../storage/db';
import { Icon } from './icons';
import { closeTab, useTabs } from './tabsStore';

/**
 * Open notebooks as tabs above the editor. Shown once two or more are open. Notebooks that were
 * deleted or moved to the trash drop out of the bar.
 */
export function TabsBar({ active, activeTitle, onSwitch, onClosed }: { active: string; activeTitle: string; onSwitch: (id: string) => void; onClosed: (id: string, next: string | null) => void }) {
  const tabs = useTabs();
  const [metas, setMetas] = useState<Map<string, NotebookMeta>>(new Map());
  const key = tabs.join();
  useEffect(() => {
    void listNotebooks().then((all) => setMetas(new Map(all.map((m) => [m.id, m]))));
  }, [key]);

  const shown = tabs.filter((id) => id === active || (metas.get(id) && metas.get(id)!.trashedAt === null));
  if (shown.length < 2) return null;
  return (
    <nav className="tabs-bar" data-no-gesture role="tablist" aria-label="Open notebooks">
      {shown.map((id) => {
        const title = id === active ? activeTitle : (metas.get(id)?.title ?? 'Notebook');
        return (
          <div key={id} className={`nb-tab ${id === active ? 'active' : ''}`}>
            <button role="tab" aria-selected={id === active} className="nb-tab-title" title={title} onClick={() => id !== active && onSwitch(id)}>
              {metas.get(id)?.lock && <Icon name="lock" />}
              <span>{title}</span>
            </button>
            <button className="nb-tab-close" aria-label={`Close ${title}`} title="Close tab" onClick={() => onClosed(id, closeTab(id, active))}>
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
