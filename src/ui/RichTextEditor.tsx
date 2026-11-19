// The formatted-text editor for text boxes and sticky notes. Loaded only when editing starts
// (TipTap is large), and reports its content as stored blocks.
import { useEffect, useReducer, useRef, type CSSProperties, type MutableRefObject } from 'react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import type { RichBlock } from '../core/model';
import { blocksFromDoc, docFromBlocks, type DocNode } from '../core/richDoc';
import { HIGHLIGHT, INDENT_EM } from '../core/richText';

export interface RichEditorHandle {
  getBlocks(): RichBlock[];
}

const MAX_INDENT = 8;

/** Indent or outdent: list items nest and un-nest; paragraphs step in and out. */
function shift(editor: Editor, d: 1 | -1): boolean {
  if (editor.isActive('listItem')) {
    return d > 0 ? editor.commands.sinkListItem('listItem') || true : editor.commands.liftListItem('listItem') || true;
  }
  const cur = Number(editor.getAttributes('paragraph').indent) || 0;
  editor.commands.updateAttributes('paragraph', { indent: Math.max(0, Math.min(MAX_INDENT, cur + d)) });
  return true;
}

/** Paragraph indent, stored as an attribute and shown as padding, with Tab and Shift-Tab. */
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `padding-left: ${a.indent * INDENT_EM}em` } : {}),
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return { Tab: () => shift(this.editor, 1), 'Shift-Tab': () => shift(this.editor, -1) };
  },
});

interface Props {
  blocks: RichBlock[];
  /** Where and how the text is drawn: matches the item on the page. */
  style: CSSProperties;
  className: string;
  label: string;
  handle: MutableRefObject<RichEditorHandle | null>;
  /** Editing ended (focus left, or Escape). */
  onDone: () => void;
}

interface Tool {
  label: string;
  glyph: string;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
  style?: CSSProperties;
}

const TOOLS: Tool[] = [
  { label: 'Bold', glyph: 'B', style: { fontWeight: 700 }, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'Italic', glyph: 'I', style: { fontStyle: 'italic', fontFamily: 'Georgia, serif' }, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  {
    label: 'Highlight',
    glyph: 'H',
    style: { background: HIGHLIGHT, color: '#1d1d1f', borderRadius: 3, padding: '0 3px' },
    active: (e) => e.isActive('highlight'),
    run: (e) => e.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run(),
  },
  { label: 'Bulleted list', glyph: '•≡', active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: 'Numbered list', glyph: '1.≡', active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: 'Outdent', glyph: '⇤', active: () => false, run: (e) => (e.commands.focus(), shift(e, -1)) },
  { label: 'Indent', glyph: '⇥', active: () => false, run: (e) => (e.commands.focus(), shift(e, 1)) },
];

export default function RichTextEditor({ blocks, style, className, label, handle, onDone }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const editor = new Editor({
      element: host.current!,
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
          code: false,
          strike: false,
          underline: false,
          link: false,
          dropcursor: false,
          trailingNode: false,
        }),
        Highlight.configure({ multicolor: true }),
        Indent,
      ],
      content: docFromBlocks(blocks),
      autofocus: 'end',
      editorProps: { attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' } },
      onTransaction: () => refresh(),
      onBlur: () => done.current(),
    });
    editorRef.current = editor;
    handle.current = { getBlocks: () => blocksFromDoc(editor.getJSON() as DocNode) };
    refresh();
    return () => {
      handle.current = null;
      editorRef.current = null;
      editor.destroy();
    };
    // The editor is made once per edit; the item's later changes come from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = editorRef.current;
  return (
    <>
      <div
        ref={host}
        className={`item-editor rich ${className}`}
        data-no-gesture
        style={style}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') editorRef.current?.commands.blur();
        }}
      />
      {editor && (
        <div
          className="format-bar"
          data-no-gesture
          role="toolbar"
          aria-label="Text formatting"
          style={{ left: style.left, top: `calc(${typeof style.top === 'number' ? `${style.top}px` : style.top} - 46px)` }}
          // Keep the text focused (and the edit open) while a button is pressed.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {TOOLS.map((t) => (
            <button key={t.label} className={t.active(editor) ? 'active' : ''} aria-pressed={t.active(editor)} aria-label={t.label} title={t.label} onClick={() => t.run(editor)}>
              <span style={t.style}>{t.glyph}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
