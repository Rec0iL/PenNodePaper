import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '@pnp/shared';

// Picture files that come in from outside (the GM imports them): what they are, how big, and where they are kept.

export type ImageExt = 'png' | 'jpg' | 'webp';

/** What kind of picture the bytes are, by their first bytes (never by a name the sender gave); null for anything else. */
export function sniffImage(b: Buffer): ImageExt | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Width/height of a PNG, JPEG or WebP file (enough header parsing, no dependency). */
export function imageDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const k = buf.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export const MAX_IMPORT_BYTES = 40_000_000;

/** Largest side (px) accepted: far more than any map or portrait needs, small enough that a thumbnail can still be made. */
export const MAX_IMPORT_SIDE = 12_000;

export interface ImportedImage {
  bytes: Buffer;
  ext: ImageExt;
  w: number;
  h: number;
}

/** Check a picture that arrived as raw bytes; throws a sentence the GM can read. */
export function checkImport(bytes: Buffer): ImportedImage {
  if (!bytes.length) throw new Error('The file is empty.');
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error(`The picture is too big (${Math.round(bytes.length / 1e6)} MB, the limit is ${MAX_IMPORT_BYTES / 1e6} MB).`);
  const ext = sniffImage(bytes);
  const dim = ext ? imageDimensions(bytes) : null;
  if (!ext || !dim || dim.w < 1 || dim.h < 1) throw new Error('That is not a PNG, JPEG or WebP picture.');
  if (dim.w > MAX_IMPORT_SIDE || dim.h > MAX_IMPORT_SIDE) throw new Error(`The picture is ${dim.w}×${dim.h} px — the limit is ${MAX_IMPORT_SIDE} px per side.`);
  return { bytes, ext, ...dim };
}

/** Keep an imported picture in the campaign's image folder. The name comes from the content, so the same picture is kept once. */
export function keepImport(dir: string, nodeId: string, img: ImportedImage, tag = 'import'): string {
  const hash = createHash('sha1').update(img.bytes).digest('hex').slice(0, 8);
  const file = `${slugify(nodeId)}-${tag}-${hash}.${img.ext}`;
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, img.bytes);
  return file;
}
