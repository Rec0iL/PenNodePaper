// Small copies of images for the UI: a node card or a tile shows an image at 100–200 px, so the browser should not
// have to download, decode and repaint a 1.3 MB 1344×768 PNG for it (that gets heavy with every image you generate).
// Thumbnails are made once with ImageMagick (if installed), cached in images/.thumbs/<width>/, and the original is
// served when anything goes wrong.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const THUMB_WIDTHS = [96, 160, 240, 320, 480, 720] as const;

/** The smallest allowed width that is at least `want` (so a thumbnail is never blurry at the size it is shown). */
export const snapWidth = (want: number) => THUMB_WIDTHS.find((w) => w >= want) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];

let magick: 'magick' | 'convert' | null | undefined;
const pending = new Map<string, Promise<string | null>>();

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 30_000 }, (err) => resolve(!err)));
}

async function findMagick(): Promise<'magick' | 'convert' | null> {
  if (magick !== undefined) return magick;
  magick = (await run('magick', ['-version'])) ? 'magick' : (await run('convert', ['-version'])) ? 'convert' : null;
  return magick;
}

/** Path of a cached thumbnail (made now if needed), or null when it cannot be made — then serve the original. */
export function thumbnail(imagesDir: string, file: string, width: number): Promise<string | null> {
  const w = snapWidth(width);
  const src = path.join(imagesDir, path.basename(file));
  const out = path.join(imagesDir, '.thumbs', String(w), `${path.basename(file)}.webp`);
  const key = out;
  const hit = pending.get(key);
  if (hit) return hit;
  const job = (async () => {
    try {
      const s = await fs.promises.stat(src);
      const t = await fs.promises.stat(out).catch(() => null);
      if (t && t.mtimeMs >= s.mtimeMs) return out;
      const bin = await findMagick();
      if (!bin) return null;
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.${process.pid}.tmp.webp`;
      const args = [src + '[0]', '-auto-orient', '-resize', `${w}x>`, '-strip', '-quality', '80', tmp];
      const ok = await run(bin, bin === 'magick' ? args : args);
      if (!ok) { await fs.promises.rm(tmp, { force: true }); return null; }
      await fs.promises.rename(tmp, out);
      return out;
    } catch {
      return null;
    } finally {
      setTimeout(() => pending.delete(key), 0);
    }
  })();
  pending.set(key, job);
  return job;
}
