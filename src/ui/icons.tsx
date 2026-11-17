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
  pages: 'M9 3h10v14H9zM5 7v14h10',
  sidebar: 'M4 4h16v16H4zM9.5 4v16',
  bookmark: 'M7 3.5h10v17l-5-4-5 4z',
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
  text: 'M5 7V4.5h14V7M12 4.5v15M9 19.5h6',
  sticky: 'M4.5 4.5h15v9l-6 6h-9zM13.5 19.5v-6h6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5a1.5 1.5 0 110 .01',
  timer: 'M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2.5 2M9.5 2.5h5',
  close: 'M6 6l12 12M18 6L6 18',
  forward: 'M9 5l7 7-7 7',
  newline: 'M19 5v7a3 3 0 01-3 3H6M10 11l-4 4 4 4',
  ruler: 'M3 15.5L15.5 3 21 8.5 8.5 21zM7.5 11.5l2 2M10.5 8.5l1.5 1.5M13.5 5.5l2 2',
  zoomWindow: 'M3 14h18v6.5H3zM9.5 3.5h5v5h-5zM12 8.5V14',
  elements: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13.5v6M13.5 16.5h6',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5v14M16 5v14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  shapes: 'M7 3.5a3.5 3.5 0 110 7a3.5 3.5 0 110-7zM13.5 13.5h7v7h-7zM7 13.5l3.8 7H3.2z',
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}
