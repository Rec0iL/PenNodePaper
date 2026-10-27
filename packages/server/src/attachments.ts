import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatAttachment } from '@pnp/shared';
import { extractText } from './imports.js';
import { imageDimensions, sniffImage } from './imagefile.js';

// ---------------------------------------------------------------------------
// Files the GM sends along with a chat message (pictures, notes, PDFs …). They live in the campaign's attachments/
// folder under a name the app makes (att-<hex>.<ext>), next to a small .json with the name the GM's file had.
// The AI looks at them through its tools (view_image, read_attachment) and can turn a picture into a node's image
// or a map. A picture the campaign already has (images/) is referred to by its own file name instead.
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 40_000_000;
const ID = /^att-[0-9a-f]{12}$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export interface StoredAttachment extends ChatAttachment {
  file: string;
  mime: string;
  w?: number;
  h?: number;
}

export class Attachments {
  constructor(readonly dir: string) {}

  /** Keep a file. Pictures are recognised by their first bytes (PNG, JPEG, WebP), everything else is a file. */
  save(name: string, bytes: Buffer): StoredAttachment {
    if (!bytes.length) throw new Error('The file is empty.');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`The file is too big (the limit is ${MAX_ATTACHMENT_BYTES / 1e6} MB).`);
    const clean = path.basename(name).replace(/[^\p{L}\p{N} ._()-]+/gu, '_').slice(0, 120) || 'file';
    const pic = sniffImage(bytes);
    const dim = pic ? imageDimensions(bytes) : null;
    const id = `att-${randomBytes(6).toString('hex')}`;
    const ext = pic ?? (path.extname(clean).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.bin').replace(/^\./, '');
    const file = `${id}.${ext}`;
    const meta: StoredAttachment = {
      id, name: clean, kind: pic ? 'image' : 'file', size: bytes.length, file, mime: pic ? MIME[pic] : 'application/octet-stream',
      ...(dim ? { w: dim.w, h: dim.h } : {}),
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, file), bytes);
    fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(meta));
    return meta;
  }

  has(id: string): boolean {
    return ID.test(id) && fs.existsSync(path.join(this.dir, `${id}.json`));
  }

  get(id: string): StoredAttachment {
    if (!ID.test(id)) throw new Error(`"${id}" is not an attachment id (att-…).`);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8')) as StoredAttachment;
      return { ...m, file: path.basename(m.file) };
    } catch {
      throw new Error(`No attachment "${id}".`);
    }
  }

  bytes(id: string): Buffer {
    return fs.readFileSync(path.join(this.dir, this.get(id).file));
  }

  /** The text of a file attachment (notes, Word, PDF), as far as it can be read. */
  text(id: string, max = 60_000): { text: string; truncated: boolean } {
    const a = this.get(id);
    if (a.kind === 'image') throw new Error(`“${a.name}” is a picture — look at it with view_image.`);
    const t = extractText(this.bytes(id), a.name);
    return { text: t.slice(0, max), truncated: t.length > max };
  }
}
