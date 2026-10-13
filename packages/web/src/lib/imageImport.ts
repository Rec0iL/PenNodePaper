import { fitRect, type FitMode } from '@pnp/shared';

// Pictures the GM brings in: read in the browser, scaled onto a canvas (so the preview is what is stored), sent as raw bytes.

/** What the file pickers offer. PNG, JPEG and WebP go as they are; other formats the browser can read are converted. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp';
const AS_IS = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_PICTURE_BYTES = 40_000_000;

export interface Picture {
  name: string;
  w: number;
  h: number;
  bitmap: ImageBitmap;
}

export async function loadPicture(file: File): Promise<Picture> {
  try {
    const bitmap = await createImageBitmap(file);
    return { name: file.name, w: bitmap.width, h: bitmap.height, bitmap };
  } catch {
    throw new Error(`“${file.name}” is not a picture this browser can read.`);
  }
}

export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture.'))), 'image/png'));
}

/** Draw `pic` into a canvas of exactly w×h: fit / fill / stretch, empty bars in `bars`. */
export function scaleOnto(canvas: HTMLCanvasElement, pic: Picture, w: number, h: number, mode: FitMode, bars: string) {
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bars;
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const r = fitRect(pic.w, pic.h, w, h, mode);
  g.drawImage(pic.bitmap, r.x, r.y, r.w, r.h);
}

async function post(url: string, body: Blob): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, json } : { ok: false, error: String(json.error ?? `the server said ${res.status}`) };
  } catch (e) {
    return { ok: false, error: `Server unreachable: ${e instanceof Error ? e.message : e}` };
  }
}

/** Add a picture to a node's gallery. */
export async function importNodePicture(nodeId: string, file: File) {
  let body: Blob = file;
  if (!AS_IS.has(file.type)) {
    // GIF, AVIF, BMP…: kept as a PNG
    const pic = await loadPicture(file).catch((e: Error) => e);
    if (pic instanceof Error) return { ok: false as const, error: pic.message };
    const c = document.createElement('canvas');
    scaleOnto(c, pic, pic.w, pic.h, 'stretch', '#00000000');
    body = await toPngBlob(c);
  }
  if (body.size > MAX_PICTURE_BYTES) return { ok: false as const, error: `That picture is too big (${Math.round(body.size / 1e6)} MB, the limit is ${MAX_PICTURE_BYTES / 1e6} MB).` };
  return post(`/api/nodes/${encodeURIComponent(nodeId)}/images/import`, body);
}

/** Send a map's finished picture (already scaled to the map's size). */
export async function importMapPicture(mapId: string, png: Blob, as: 'render' | 'terrain') {
  return post(`/api/maps/${encodeURIComponent(mapId)}/import?as=${as}`, png);
}
