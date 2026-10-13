import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LABEL_FONTS, LABEL_STYLES, applyOps, layoutLabel, newMap, placeLabels, estimateWidth, type MapDoc } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { FONT_DIR, installLabelContext, labelFontFiles, printNames } from '../src/labels.js';
import { Maps, imageSize, renderSvg, toPng } from '../src/maps.js';
import { imageDimensions } from '../src/vtt.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

const ctx = { measure: estimateWidth };
const geo = (m: MapDoc) => { const g = imageSize(m); return { W: g.w, H: g.h, cell: g.cell }; };

describe('lettering styles', () => {
  it('every style has its font bundled and lays out into a box', () => {
    for (const f of LABEL_FONTS) expect(fs.existsSync(path.join(FONT_DIR, `${f}.ttf`)), f).toBe(true);
    expect(labelFontFiles()).toHaveLength(LABEL_FONTS.length);
    for (const s of LABEL_STYLES) {
      const b = layoutLabel('Salt Harbour', s.id, 20, ctx);
      expect(b.w, s.id).toBeGreaterThan(40);
      expect(b.h, s.id).toBeGreaterThan(15);
      expect(b.draw(10, 10), s.id).toContain('<text');
    }
  });

  it('long names are set on two lines when the box would be too wide', () => {
    const one = layoutLabel('The Weeping Chapel of the Drowned Saints', 'banner', 20, ctx);
    const two = layoutLabel('The Weeping Chapel of the Drowned Saints', 'banner', 20, ctx, 300);
    expect(two.w).toBeLessThan(one.w);
    expect(two.h).toBeGreaterThan(one.h);
    expect(two.draw(0, 0).match(/<text /g)).toHaveLength(2 + 2); // two lines, each also as its shadow
  });
});

describe('where names stand', () => {
  const room = () => {
    const m = newMap('t', 'T', 'battle', 20, 14);
    applyOps(m, [{ op: 'room', x: 4, y: 4, w: 6, h: 4 }]);
    return m;
  };

  it('above, in the middle of, and below an area', () => {
    const m = room();
    const area = { x: 4, y: 4, w: 6, h: 4 };
    applyOps(m, [
      { op: 'label', x: 7, y: 6, text: 'Hall', area, place: 'above' },
      { op: 'label', x: 7, y: 6, text: 'Kitchen', area, place: 'middle', style: 'noir' },
      { op: 'label', x: 7, y: 6, text: 'Cellar', area, place: 'below', style: 'blueprint' },
    ]);
    const g = geo(m), c = g.cell;
    const [above, mid, below] = placeLabels(m, g, ctx);
    expect(above.y + above.h).toBeLessThanOrEqual(4 * c);
    expect(mid.y).toBeGreaterThanOrEqual(4 * c - 1);
    expect(mid.y + mid.h).toBeLessThanOrEqual(8 * c + 40); // centred, maybe moved by the nudge that keeps names apart
    expect(below.y).toBeGreaterThanOrEqual(8 * c);
    // centred on the area
    expect(above.x + above.w / 2).toBeCloseTo(7 * c, 0);
    expect(mid.style).toBe('noir');
    expect(below.style).toBe('blueprint');
  });

  it('names never overlap and never leave the picture', () => {
    const m = newMap('t', 'T', 'battle', 12, 8);
    applyOps(m, [
      { op: 'label', x: 6, y: 4, text: 'One' }, { op: 'label', x: 6, y: 4, text: 'Two' }, { op: 'label', x: 0.2, y: 0.1, text: 'Corner of the world' },
    ]);
    const g = geo(m);
    const p = placeLabels(m, g, ctx);
    for (let i = 0; i < p.length; i++) {
      expect(p[i].x).toBeGreaterThanOrEqual(0);
      expect(p[i].y).toBeGreaterThanOrEqual(0);
      expect(p[i].x + p[i].w).toBeLessThanOrEqual(g.W);
      for (let j = i + 1; j < p.length; j++) expect(p[i].x < p[j].x + p[j].w && p[j].x < p[i].x + p[i].w && p[i].y < p[j].y + p[j].h && p[j].y < p[i].y + p[i].h, `${i}/${j}`).toBe(false);
    }
  });

  it('region maps name their shapes: places below, land in the middle; a shape keeps its print options when redrawn', () => {
    const m = newMap('r', 'R', 'region');
    applyOps(m, [
      { op: 'shape', type: 'polygon', kind: 'forest', points: [[100, 100], [400, 100], [400, 300], [100, 300]], label: 'Darkwood', id: 'f' },
      { op: 'shape', type: 'ellipse', kind: 'city', points: [[700, 200], [40, 30]], label: 'Eldoria', id: 'c', labelStyle: 'banner', labelPlace: 'above' },
    ]);
    const p = placeLabels(m, geo(m), ctx);
    expect(p.find((x) => x.text === 'Darkwood')!.place).toBe('middle');
    expect(p.find((x) => x.text === 'Eldoria')).toMatchObject({ place: 'above', style: 'banner' });
    // moved by the editor: the shape op carries no label options, the stored ones stay
    applyOps(m, [{ op: 'shape', type: 'ellipse', kind: 'city', points: [[720, 220], [40, 30]], label: 'Eldoria', id: 'c' }]);
    expect(m.shapes.find((s) => s.id === 'c')).toMatchObject({ labelStyle: 'banner', labelPlace: 'above' });
    applyOps(m, [{ op: 'shape', type: 'ellipse', kind: 'city', points: [[720, 220], [40, 30]], label: 'Eldoria', id: 'c', labelStyle: null, labelShow: false }]);
    expect(m.shapes.find((s) => s.id === 'c')).toMatchObject({ labelPlace: 'above', labelShow: false });
    expect(m.shapes.find((s) => s.id === 'c')!.labelStyle).toBeUndefined();
  });

  it('ops validate the print options and move the area with its label', () => {
    const m = room();
    expect(() => applyOps(m, [{ op: 'label', x: 1, y: 1, text: 'x', style: 'nope' }])).toThrow(/Unknown lettering style/);
    expect(() => applyOps(m, [{ op: 'label', x: 1, y: 1, text: 'x', place: 'beside' as never }])).toThrow(/place must be/);
    applyOps(m, [{ op: 'label', x: 7, y: 6, text: 'Hall', area: { x: 4, y: 4, w: 6, h: 4 }, place: 'below', size: 'lg', show: false }]);
    expect(m.labels[0]).toMatchObject({ place: 'below', size: 'lg', show: false, x: 7, y: 6 });
    applyOps(m, [{ op: 'edit_label', x: 7, y: 6, to: [8, 7], show: true, size: null }]);
    expect(m.labels[0]).toMatchObject({ x: 8, y: 7, area: { x: 5, y: 5, w: 6, h: 4 } });
    expect(m.labels[0].show).toBeUndefined();
    expect(m.labels[0].size).toBeUndefined();
    applyOps(m, [{ op: 'move_area', x: 4, y: 4, w: 7, h: 5, dx: 2, dy: 1, copy: true }]);
    expect(m.labels.some((l) => l.area && l.area.x === 7 && l.area.y === 6)).toBe(true);
    applyOps(m, [{ op: 'lettering', style: 'grimoire' }]);
    expect(m.lettering).toEqual({ style: 'grimoire' });
    expect(() => applyOps(m, [{ op: 'lettering', style: 'x' }])).toThrow();
  });

  it('the plan picture and the editor drawing contain the names as lettering', () => {
    installLabelContext();
    const m = room();
    applyOps(m, [{ op: 'label', x: 7, y: 6, text: 'Armoury', style: 'wasteland' }, { op: 'label', x: 2, y: 2, text: 'Hidden', show: false }]);
    const svg = renderSvg(m, 'preview');
    expect(svg).toContain('PNP stardos');
    expect(svg).toContain('ARMOURY');
    expect(svg).not.toContain('class="letters"><g opacity="0.35"></g>');
    expect(renderSvg(m, 'control')).not.toContain('<text');
    expect(toPng(svg).length).toBeGreaterThan(1000);
  });
});

describe('changing names and shapes in place', () => {
  it('names have handles; edit_label and remove_label work by id', () => {
    const m = newMap('t', 'T', 'battle', 20, 14);
    const r = applyOps(m, [
      { op: 'label', x: 3, y: 3, text: 'Hall' },
      { op: 'label', x: 8, y: 3, text: 'Kitchen', id: 'kit' },
      { op: 'label', x: 12, y: 8, text: 'Cellar' },
    ]);
    expect(m.labels.map((l) => l.id)).toEqual(['l1', 'kit', 'l3']);
    expect(r.notes).toEqual(['label “Hall” is l1', 'label “Kitchen” is kit', 'label “Cellar” is l3']);
    applyOps(m, [{ op: 'edit_label', id: 'kit', text: 'Great kitchen', style: 'banner', place: 'above', to: [9, 4] }]);
    expect(m.labels[1]).toMatchObject({ id: 'kit', text: 'Great kitchen', style: 'banner', place: 'above', x: 9, y: 4 });
    // a label with the same id is replaced, not duplicated
    applyOps(m, [{ op: 'label', id: 'kit', x: 9, y: 4, text: 'Kitchen again' }]);
    expect(m.labels).toHaveLength(3);
    expect(m.labels[1].text).toBe('Kitchen again');
    expect(() => applyOps(m, [{ op: 'edit_label', id: 'nope', text: 'x' }])).toThrow(/No label "nope".*l1 “Hall”/);
    expect(() => applyOps(m, [{ op: 'edit_label', text: 'x' }])).toThrow(/needs the label id/);
    applyOps(m, [{ op: 'remove_label', id: 'l1' }]);
    expect(m.labels.map((l) => l.id)).toEqual(['kit', 'l3']);
    // the old way still works
    applyOps(m, [{ op: 'edit_label', x: 12, y: 8, text: 'Wine cellar' }, { op: 'remove_label', x: 9, y: 4 }]);
    expect(m.labels.map((l) => l.text)).toEqual(['Wine cellar']);
  });

  it('names made before handles get them when the map is loaded; copies get new ones', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-ids-'));
    try {
      const maps = new Maps(d);
      const m = maps.create('Old', 'battle', 12, 8);
      applyOps(m, [{ op: 'room', x: 1, y: 1, w: 4, h: 3 }]);
      m.labels = [{ x: 2, y: 2, text: 'A' }, { x: 4, y: 2, text: 'B' }];
      maps.save(m, { backup: 'none' });
      const back = maps.get(m.id);
      expect(back.labels.map((l) => l.id)).toEqual(['l1', 'l2']);
      applyOps(back, [{ op: 'move_area', x: 1, y: 1, w: 4, h: 3, dx: 0, dy: 3, copy: true }]);
      const ids = back.labels.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(maps.describe(back)).toContain('l1 "A"@2,2');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('edit_shape changes only what is given', () => {
    const m = newMap('r', 'R', 'region');
    applyOps(m, [
      { op: 'shape', type: 'polygon', kind: 'forest', points: [[100, 100], [300, 100], [300, 250]], label: 'Darkwood', id: 'f', labelPlace: 'above' },
      { op: 'shape', type: 'ellipse', kind: 'city', points: [[600, 300], [40, 30]], label: 'Eldoria', id: 'c', prompt: 'a walled river town' },
      { op: 'shape', type: 'path', kind: 'river', points: [[0, 0], [100, 100]], id: 'r', width: 20 },
    ]);
    applyOps(m, [{ op: 'edit_shape', id: 'c', label: 'New Eldoria', labelStyle: 'banner', labelSize: 'lg' }]);
    expect(m.shapes.find((s) => s.id === 'c')).toMatchObject({ label: 'New Eldoria', labelStyle: 'banner', labelSize: 'lg', prompt: 'a walled river town', points: [[600, 300], [40, 30]], kind: 'city' });
    applyOps(m, [{ op: 'edit_shape', id: 'c', move: [50, -20] }, { op: 'edit_shape', id: 'f', move: [10, 10] }]);
    expect(m.shapes.find((s) => s.id === 'c')!.points).toEqual([[650, 280], [40, 30]]); // the radii stay
    expect(m.shapes.find((s) => s.id === 'f')!.points).toEqual([[110, 110], [310, 110], [310, 260]]);
    applyOps(m, [{ op: 'edit_shape', id: 'f', kind: 'swamp', points: [[0, 0], [10, 0], [10, 10]], labelPlace: 'below', labelShow: false }]);
    expect(m.shapes.find((s) => s.id === 'f')).toMatchObject({ kind: 'swamp', labelPlace: 'below', labelShow: false, label: 'Darkwood' });
    applyOps(m, [{ op: 'edit_shape', id: 'f', labelShow: true, label: null }, { op: 'edit_shape', id: 'c', prompt: null, labelStyle: null, labelSize: null }, { op: 'edit_shape', id: 'r', width: null }]);
    const f = m.shapes.find((s) => s.id === 'f')!, c = m.shapes.find((s) => s.id === 'c')!;
    expect(f.label).toBeUndefined();
    expect(f.labelShow).toBeUndefined();
    expect(c.prompt).toBeUndefined();
    expect(c.labelStyle).toBeUndefined();
    expect(m.shapes.find((s) => s.id === 'r')!.width).toBeUndefined();
    expect(() => applyOps(m, [{ op: 'edit_shape', id: 'zz', label: 'x' }])).toThrow(/No shape "zz"/);
    expect(() => applyOps(m, [{ op: 'edit_shape', id: 'f', kind: 'lava-lake' }])).toThrow(/Unknown kind/);
    expect(() => applyOps(m, [{ op: 'edit_shape', id: 'f', labelStyle: 'nope' }])).toThrow(/Unknown lettering style/);
  });

  it('the AI path: edit_map ops, ids in get_map, a library kind comes along on edit_shape', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-aiops-'));
    try {
      const store = new Store(new Persistence(d));
      const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
      run('create_node', { id: 'realm', type: 'location', title: 'Realm', summary: 'x' });
      const { mapId } = run('create_map', { name: 'Realm', nodeId: 'realm', kind: 'region' });
      run('set_region_kind', { id: 'crater', name: 'Crater', layer: 'terrain', color: '#553322', prompt: 'a crater' });
      const r = run('edit_map', { mapId, ops: [
        { op: 'shape', type: 'polygon', kind: 'forest', points: [[10, 10], [200, 10], [200, 150]], label: 'Darkwood', id: 'wood' },
        { op: 'label', x: 500, y: 400, text: 'Here be dragons', style: 'seachart' },
      ] });
      expect(r.notes).toEqual(['label “Here be dragons” is l1']);
      const view = run('get_map', { mapId }).view as string;
      expect(view).toContain('wood [terrain] forest "Darkwood"');
      expect(view).toContain('l1 "Here be dragons"@500,400 style=seachart');
      run('edit_map', { mapId, ops: [{ op: 'edit_shape', id: 'wood', kind: 'crater', label: 'The Crater', labelStyle: 'runestone' }, { op: 'edit_label', id: 'l1', text: 'Dragons', show: false }] });
      const m = store.maps.get(mapId);
      expect(m.shapes[0]).toMatchObject({ kind: 'crater', label: 'The Crater', labelStyle: 'runestone' });
      expect(m.kinds?.some((k) => k.id === 'crater')).toBe(true);
      expect(m.labels[0]).toMatchObject({ text: 'Dragons', show: false });
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('printing the names on a picture', () => {
  let dir: string;
  let store: Store;
  const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-letters-'));
    store = new Store(new Persistence(dir));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function mapWithPicture() {
    run('create_node', { id: 'tavern', type: 'location', title: 'The Tavern', summary: 'x' });
    const { mapId } = run('create_map', { name: 'Tavern', nodeId: 'tavern', kind: 'battle', cols: 16, rows: 10 });
    run('edit_map', { mapId, ops: [{ op: 'room', x: 2, y: 2, w: 8, h: 5, name: 'Taproom' }, { op: 'label', x: 6, y: 2, text: 'Kitchen', area: { x: 2, y: 2, w: 4, h: 3 }, place: 'above', style: 'noir' }] });
    const m = store.maps.get(mapId);
    fs.mkdirSync(store.imagesDir, { recursive: true });
    const png = toPng(renderSvg(m, 'terrain'));
    fs.writeFileSync(path.join(store.imagesDir, 'tavern-1.png'), png);
    m.renders.push('tavern-1.png');
    store.maps.save(m, { backup: 'none' });
    return { mapId, png };
  }

  it('printNames keeps the picture size and changes only the pixels around the names', () => {
    installLabelContext();
    const m = newMap('p', 'P', 'battle', 12, 8);
    applyOps(m, [{ op: 'room', x: 1, y: 1, w: 6, h: 4 }, { op: 'label', x: 4, y: 3, text: 'Hall', style: 'runestone' }]);
    const base = toPng(renderSvg(m, 'terrain'));
    const out = printNames(m, base);
    expect(imageDimensions(out)).toEqual(imageDimensions(base));
    expect(out.equals(base)).toBe(false);
    m.labels[0].show = false;
    expect(imageDimensions(printNames(m, base))).toEqual(imageDimensions(base));
  });

  it('print_map_names adds a new picture, replaces its own earlier print, and leaves the painted one', () => {
    const { mapId, png } = mapWithPicture();
    const r1 = run('print_map_names', { mapId });
    expect(r1.from).toBe('tavern-1.png');
    expect(r1.file).toMatch(/^tavern-1-names-[0-9a-f]{8}\.png$/);
    expect(fs.readFileSync(path.join(store.imagesDir, 'tavern-1.png')).equals(png)).toBe(true);
    let m = store.maps.get(mapId);
    expect(m.renders).toEqual(['tavern-1.png', r1.file]);
    expect(m.lettered).toEqual({ [r1.file]: 'tavern-1.png' });
    expect(store.state.nodes.tavern.images).toContain(r1.file);
    // same names: same file, no duplicates
    expect(run('print_map_names', { mapId }).file).toBe(r1.file);
    expect(store.maps.get(mapId).renders).toEqual(['tavern-1.png', r1.file]);
    // changed names print again from the PAINTED picture, and the old print leaves the lists
    run('edit_map', { mapId, ops: [{ op: 'lettering', style: 'seachart' }] });
    const r2 = run('print_map_names', { mapId, render: r1.file });
    expect(r2.from).toBe('tavern-1.png');
    expect(r2.file).not.toBe(r1.file);
    m = store.maps.get(mapId);
    expect(m.renders).toEqual(['tavern-1.png', r2.file]);
    expect(m.lettered).toEqual({ [r2.file]: 'tavern-1.png' });
    expect(store.state.nodes.tavern.images).not.toContain(r1.file);
    expect(run('get_map', { mapId }).lettering).toMatchObject({ style: 'seachart', namesToPrint: 2 });
  });

  it('refuses when there is nothing to print or no picture', () => {
    run('create_node', { id: 'cell', type: 'location', title: 'Cell', summary: 'x' });
    const { mapId } = run('create_map', { name: 'Cell', nodeId: 'cell', kind: 'battle' });
    expect(() => run('print_map_names', { mapId })).toThrow(/no painted picture/);
  });
});
