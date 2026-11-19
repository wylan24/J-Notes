import { useEffect, useMemo, useRef } from 'react';
import { blankPage, type PageSetup, type PageSize, type Paper, type Template } from '../core/model';
import { newId } from '../core/ids';
import { prepareImage } from '../io/images';
import { paintPage } from '../render/page';
import { Icon } from './icons';

export const TEMPLATES: { id: Template; label: string }[] = [
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'blank', label: 'Blank' },
  { id: 'legal', label: 'Legal' },
  { id: 'cornell', label: 'Cornell' },
  { id: 'music', label: 'Music' },
  { id: 'planner', label: 'Weekly' },
];

/** Width, in CSS px, the template previews are painted at. */
const PREVIEW_W = 72;

/** A small page painted by the real renderer, so previews match what the notebook will show. */
function TemplatePreview({ setup, image }: { setup: PageSetup; image?: HTMLImageElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const page = blankPage('preview', setup);
    paintPage(c, page, PREVIEW_W / setup.size.w, Math.min(window.devicePixelRatio || 1, 3), { items: { images: () => image ?? null } });
  }, [setup, image]);
  return <canvas ref={ref} className="paper" style={{ aspectRatio: `${setup.size.w} / ${setup.size.h}` }} />;
}

/** An image picked as a custom template, not yet stored: its blob gets saved when the choice is applied. */
export interface CustomTemplate {
  blob: { id: string; type: string; bytes: ArrayBuffer };
  img: HTMLImageElement;
}

/** The template tiles, previewed at the given size and paper, plus a tile to pick an image. */
export function TemplateGrid({
  size,
  paper,
  value,
  onChange,
  custom,
  onCustom,
}: {
  size: PageSize;
  paper: Paper;
  value: Template | 'image';
  onChange: (v: Template | 'image') => void;
  custom: CustomTemplate | null;
  onCustom: (c: CustomTemplate) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const setups = useMemo(() => TEMPLATES.map((t) => ({ ...t, setup: { template: t.id, size, paper } })), [size, paper]);
  const customSetup = useMemo<PageSetup | null>(
    () => (custom ? { template: 'blank', size, paper, background: { kind: 'image', blobId: custom.blob.id } } : null),
    [custom, size, paper],
  );

  const pickImage = async (file: File) => {
    try {
      const prepared = await prepareImage(file);
      onCustom({ blob: { id: newId(), type: prepared.type, bytes: prepared.bytes }, img: prepared.img });
      onChange('image');
    } catch (e) {
      alert(`Could not use this image: ${(e as Error).message}`);
    }
  };

  return (
    <div className="template-row">
      {setups.map((t) => (
        <button type="button" key={t.id} className={`template-pick ${value === t.id ? 'active' : ''}`} aria-pressed={value === t.id} onClick={() => onChange(t.id)}>
          <TemplatePreview setup={t.setup} />
          {t.label}
        </button>
      ))}
      <button
        type="button"
        className={`template-pick ${value === 'image' ? 'active' : ''}`}
        aria-pressed={value === 'image'}
        title="Use an image as the template"
        onClick={() => (custom && value !== 'image' ? onChange('image') : imageInput.current?.click())}
      >
        {customSetup && custom ? (
          <TemplatePreview setup={customSetup} image={custom.img} />
        ) : (
          <span className="paper paper-add" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            <Icon name="plus" />
          </span>
        )}
        {custom && value === 'image' ? 'Change…' : 'Image…'}
      </button>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickImage(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
