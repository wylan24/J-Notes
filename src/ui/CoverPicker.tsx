import { useRef, useState } from 'react';
import { prepareCoverImage } from '../io/images';
import { Icon } from './icons';

export const COVERS = ['#3d5a80', '#c8553d', '#2a9d8f', '#e9c46a', '#6d597a', '#264653'];

/**
 * A notebook's cover: a colour (always; it is the spine), and optionally a picture shown on the
 * front instead of the first page.
 */
export function CoverPicker({
  color,
  onColor,
  image,
  onImage,
}: {
  color: string;
  onColor: (c: string) => void;
  image: string | undefined;
  onImage: (dataUrl: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    setBusy(true);
    try {
      onImage(await prepareCoverImage(file));
    } catch (e) {
      alert(`Could not use this picture: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="field">
      <legend>Cover</legend>
      <div className="cover-row">
        {COVERS.map((c) => (
          <button type="button" key={c} className={`cover-pick ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onColor(c)} aria-label={`Cover colour ${c}`} />
        ))}
      </div>
      <div className="cover-image-row">
        {image ? (
          <>
            <span className="cover-image-preview" style={{ borderLeftColor: color }}>
              <img src={image} alt="" />
            </span>
            <button type="button" className="btn sm ghost" onClick={() => input.current?.click()} disabled={busy}>
              Change picture…
            </button>
            <button type="button" className="btn sm ghost" onClick={() => onImage(undefined)}>
              Remove
            </button>
          </>
        ) : (
          <button type="button" className="btn sm ghost" onClick={() => input.current?.click()} disabled={busy}>
            <Icon name="image" /> {busy ? 'Preparing…' : 'Use a picture…'}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pick(f);
          }}
        />
      </div>
    </fieldset>
  );
}

/** Rename a notebook and change its cover. */
export function EditNotebookDialog({
  title,
  cover,
  coverImage,
  onCancel,
  onSave,
}: {
  title: string;
  cover: string;
  coverImage: string | undefined;
  onCancel: () => void;
  onSave: (title: string, cover: string, coverImage: string | undefined) => void;
}) {
  const [name, setName] = useState(title);
  const [color, setColor] = useState(cover);
  const [image, setImage] = useState(coverImage);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label="Edit notebook"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name.trim() || title, color, image);
        }}
      >
        <h2>Edit notebook</h2>
        <label className="field">
          <span>Title</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <CoverPicker color={color} onColor={setColor} image={image} onImage={setImage} />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
