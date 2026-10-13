import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fitRect, gridForPicture, sizeForPicture } from '@pnp/shared';
import { MAX_IMPORT_SIDE, checkImport, imageDimensions, keepImport, sniffImage } from '../src/imagefile.js';
import { toPng } from '../src/maps.js';

const png = (w: number, h: number) => toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#4a8"/></svg>`);
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const webp = (w: number, h: number) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBPVP8X', 8, 'ascii');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
};

describe('imported pictures: what is accepted', () => {
  it('knows PNG, JPEG and WebP by their bytes and reads their size', () => {
    expect(sniffImage(png(40, 30))).toBe('png');
    expect(sniffImage(jpeg(40, 30))).toBe('jpg');
    expect(sniffImage(webp(40, 30))).toBe('webp');
    expect(imageDimensions(png(40, 30))).toEqual({ w: 40, h: 30 });
    expect(imageDimensions(jpeg(640, 480))).toEqual({ w: 640, h: 480 });
    expect(imageDimensions(webp(1000, 700))).toEqual({ w: 1000, h: 700 });
  });

  it('refuses anything else with a sentence the GM can read', () => {
    expect(() => checkImport(Buffer.alloc(0))).toThrow(/empty/);
    expect(() => checkImport(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toThrow(/not a PNG, JPEG or WebP/);
    expect(() => checkImport(Buffer.from('GIF89a' + 'x'.repeat(40)))).toThrow(/not a PNG, JPEG or WebP/);
    expect(() => checkImport(webp(MAX_IMPORT_SIDE + 1, 100))).toThrow(/limit/);
    expect(checkImport(png(40, 30))).toMatchObject({ ext: 'png', w: 40, h: 30 });
  });
});

describe('imported pictures: kept in the campaign', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-import-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('names the file after the node and the content, so the same picture is kept once', () => {
    const a = keepImport(dir, 'Old Hild', checkImport(png(40, 30)));
    const b = keepImport(dir, 'Old Hild', checkImport(png(40, 30)));
    const c = keepImport(dir, 'Old Hild', checkImport(png(41, 30)));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(a).toMatch(/^old-hild-import-[0-9a-f]{8}\.png$/);
    expect(fs.readdirSync(dir).sort()).toEqual([a, c].sort());
    expect(keepImport(dir, 'm', checkImport(jpeg(8, 8)), 'import-terrain')).toMatch(/^m-import-terrain-[0-9a-f]{8}\.jpg$/);
  });
});

describe('scaling a picture onto a map', () => {
  it('fit keeps all of it, fill covers the map, stretch squeezes', () => {
    expect(fitRect(200, 100, 100, 100, 'fit')).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fitRect(200, 100, 100, 100, 'fill')).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(fitRect(200, 100, 100, 100, 'stretch')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    // the same shape: all three agree
    for (const mode of ['fit', 'fill', 'stretch'] as const) expect(fitRect(1344, 768, 1344, 768, mode)).toEqual({ x: 0, y: 0, w: 1344, h: 768 });
  });

  it('a map that takes the picture\'s proportions', () => {
    expect(gridForPicture(2000, 1500, 20)).toEqual({ cols: 20, rows: 15 });
    expect(gridForPicture(1000, 4000, 80)).toEqual({ cols: 80, rows: 80 }); // limited to the editor's grid
    expect(gridForPicture(100, 100, 2)).toEqual({ cols: 4, rows: 4 });
    const s = sizeForPicture(3000, 2000);
    expect(s.w % 16).toBe(0);
    expect(s.h % 16).toBe(0);
    expect(Math.abs(s.w / s.h - 1.5)).toBeLessThan(0.03);
    expect(s.w * s.h).toBeGreaterThan(900_000);
    expect(s.w * s.h).toBeLessThan(1_200_000);
  });
});
