// Keyboard shortcuts: the tool keys the editor listens for, and the full list the shortcuts sheet
// shows. Kept together so the sheet can't fall out of step with what the keys do.
import type { ToolKind } from './model';

export const TOOLS: { kind: ToolKind; label: string; key: string }[] = [
  { kind: 'pen', label: 'Pen', key: 'P' },
  { kind: 'highlighter', label: 'Highlighter', key: 'H' },
  { kind: 'shapes', label: 'Shapes', key: 'S' },
  { kind: 'eraser', label: 'Eraser', key: 'E' },
  { kind: 'lasso', label: 'Lasso', key: 'L' },
  { kind: 'text', label: 'Text', key: 'T' },
  { kind: 'sticky', label: 'Sticky note', key: 'N' },
  { kind: 'laser', label: 'Laser pointer', key: 'K' },
  { kind: 'tape', label: 'Tape', key: 'G' },
];

export interface Shortcut {
  /** Keys as shown, Mac style: ⌘ ⇧ ⌥ and the key. */
  keys: string;
  does: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** The key that opens the shortcuts sheet. */
export const SHORTCUTS_KEY = '?';

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  { title: 'Tools', items: TOOLS.map((t) => ({ keys: t.key, does: t.label })) },
  {
    title: 'Notebook',
    items: [
      { keys: '⌘Z', does: 'Undo' },
      { keys: '⇧⌘Z  or  ⌘Y', does: 'Redo' },
      { keys: '⌘C  ⌘X  ⌘V', does: 'Copy, cut and paste the selection' },
      { keys: '⌫', does: 'Delete the selection' },
      { keys: 'Esc', does: 'Clear the selection' },
      { keys: '⌘F', does: 'Search' },
      { keys: 'R', does: 'Show or hide the ruler' },
      { keys: '← →', does: 'Turn the ruler by 1° (while it has focus)' },
      { keys: 'W', does: 'Show or hide the zoom window' },
      { keys: '⌘+  ⌘−', does: 'Zoom in and out' },
      { keys: '⌘0', does: 'Actual size' },
      { keys: '⌘ + scroll', does: 'Zoom at the pointer (or pinch)' },
      { keys: 'Enter  Esc', does: 'Finish or cancel cropping a photo' },
      { keys: SHORTCUTS_KEY, does: 'Show this list' },
    ],
  },
  {
    title: 'Text boxes and sticky notes',
    items: [
      { keys: '⌘B', does: 'Bold' },
      { keys: '⌘I', does: 'Italic' },
      { keys: 'Tab  ⇧Tab', does: 'Indent and outdent (nests list items)' },
      { keys: 'Esc', does: 'Finish editing' },
    ],
  },
  {
    title: 'Text documents',
    items: [
      { keys: '⌘B  ⌘I  ⌘U', does: 'Bold, italic, underline' },
      { keys: '⇧⌘S', does: 'Strikethrough' },
      { keys: '⇧⌘H', does: 'Highlight' },
      { keys: '⌥⌘1  ⌥⌘2  ⌥⌘3', does: 'Heading 1, 2, 3' },
      { keys: '⌥⌘0', does: 'Body text' },
      { keys: '⇧⌘8  ⇧⌘7  ⇧⌘9', does: 'Bulleted, numbered and check list' },
      { keys: 'Tab  ⇧Tab', does: 'Nest list items, or move between table cells' },
      { keys: '# ␣   ## ␣   ### ␣', does: 'Start a heading as you type' },
      { keys: '- ␣   1. ␣   [ ] ␣', does: 'Start a list or checklist as you type' },
    ],
  },
];

/** On Windows and Linux, ⌘ is Ctrl, ⌥ is Alt and ⇧ is Shift. */
export function forPlatform(keys: string, mac: boolean): string {
  if (mac) return keys;
  return keys.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌫/g, 'Backspace');
}
