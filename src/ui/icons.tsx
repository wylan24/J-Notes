// Small inline icon set (24px grid, stroke-based) so the app has no icon dependency.
const paths: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  pen: 'M4 20l4-1L19 8a2.1 2.1 0 00-3-3L5 16l-1 4zM14 7l3 3',
  highlighter: 'M9 11l-5 5v3h6l5-5M9 11l6-6 4 4-6 6M9 11l4 4M4 21h16',
  eraser: 'M8 20h12M5.5 14.5l8-8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8l-2.5-2.5a1.4 1.4 0 010-2z M9 11l5 5',
  lasso: 'M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5zM7 13c-1 2 0 4 2 4s2 2 0 4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  addPage: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v7h14v-7',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  pencil: 'M4 20l4-1L19 8a2.1 2.1 0 00-3-3L5 16l-1 4z',
  stylus: 'M5 19l2-6 9-9 3 3-9 9-6 2zM14 6l3 3',
  laser: 'M12 12m-2.5 0a2.5 2.5 0 105 0a2.5 2.5 0 10-5 0M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1',
  'pen-fountain': 'M12 3l5 8-5 10-5-10zM12 11v4M7 11h10',
  'pen-ball': 'M9 3h6v12l-3 6-3-6zM9 15h6',
  'pen-brush': 'M19 4l-7 8M12 12c-3-1-6 1-6 4 0 2-1 3-2 4 5 0 10-2 8-8z',
  straight: 'M4 20L20 4M4 20h3M20 4h-3',
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}
