// Turn PDF and image files into notebook pages: one page per PDF page, one per image.
// Returns the blobs to store alongside; callers decide whether they go into a new notebook or an open one.
import { newId } from '../core/ids';
import type { Page } from '../core/model';
import { imagePage, pdfPages } from '../core/pages';
import type { StoredBlob } from '../storage/db';
import { readPdf } from '../render/pdf';
import { isImageFile, prepareImage } from './images';

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export type NewBlob = Omit<StoredBlob, 'docId'>;

export interface ImportedPages {
  pages: Page[];
  blobs: NewBlob[];
  /** Names of files that were neither a PDF nor an image, or could not be read. */
  skipped: string[];
}

export async function pagesFromFiles(files: readonly File[]): Promise<ImportedPages> {
  const out: ImportedPages = { pages: [], blobs: [], skipped: [] };
  for (const file of files) {
    try {
      if (isPdfFile(file)) {
        const bytes = await file.arrayBuffer();
        const { sizes } = await readPdf(bytes);
        if (!sizes.length) throw new Error('no pages');
        const id = newId();
        out.blobs.push({ id, type: 'application/pdf', bytes });
        out.pages.push(...pdfPages(id, sizes));
      } else if (isImageFile(file)) {
        const img = await prepareImage(file);
        const id = newId();
        out.blobs.push({ id, type: img.type, bytes: img.bytes });
        out.pages.push(imagePage(id, img.width, img.height));
      } else {
        out.skipped.push(file.name);
      }
    } catch (e) {
      console.error(`Could not import ${file.name}`, e);
      out.skipped.push(file.name);
    }
  }
  return out;
}

/** A notebook title from a file name: the name without its extension. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Imported notebook';
}
