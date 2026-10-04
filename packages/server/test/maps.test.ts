import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Maps, applyOps, cellAt, derivedWalls, imageSize, newMap, renderSvg, toPng } from '../src/maps.js';

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-map-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const walls = (m: ReturnType<typeof newMap>) => derivedWalls(m).length;

describe('battle maps', () => {
  it('a single room gets a closed wall ring derived from its floor', () => {
    const m = newMap('t', 'T', 'battle', 12, 10);
    applyOps(m, [{ op: 'room', x: 2, y: 2, w: 4, h: 3, name: 'Hall' }]);
    expect(m.rows[2].slice(2, 6)).toBe('ssss');
    expect(m.rows[1]).toBe('.'.repeat(12));
    expect(walls(m)).toBe(2 * (4 + 3)); // perimeter 14 unit segments
    expect(m.labels[0]).toMatchObject({ text: 'Hall', x: 4, y: 2.7 });
  });

  it('a door removes its wall segment and works from either side', () => {
    const m = newMap('t', 'T', 'battle', 12, 10);
    applyOps(m, [{ op: 'room', x: 2, y: 2, w: 4, h: 3 }]);
    const before = walls(m);
    applyOps(m, [{ op: 'door', x: 3, y: 2, side: 'n' }]);
    expect(walls(m)).toBe(before - 1);
    // same edge described from the outside cell: replaces, no duplicate
    applyOps(m, [{ op: 'door', x: 3, y: 1, side: 's', kind: 'secret' }]);
    expect(m.doors).toHaveLength(1);
    expect(m.doors[0]).toMatchObject({ x: 3, y: 2, side: 'n', kind: 'secret' });
  });

  it('abutting rooms stay separated by an auto wall; an open edge removes it', () => {
    const m = newMap('t', 'T', 'battle', 12, 10);
    applyOps(m, [{ op: 'room', x: 1, y: 1, w: 3, h: 3 }, { op: 'room', x: 4, y: 1, w: 3, h: 3 }]);
    expect(m.walls.length).toBe(3); // the shared border
    applyOps(m, [{ op: 'open', x: 3, y: 2, side: 'e' }]);
    expect(m.walls.length).toBe(2);
  });

  it('corridors connect points; clear removes floor and props', () => {
    const m = newMap('t', 'T', 'battle', 12, 10);
    applyOps(m, [
      { op: 'corridor', from: [1, 1], to: [8, 6], width: 1, floor: 'dirt' },
      { op: 'prop', kind: 'barrel', x: 8, y: 6, id: 'b' },
    ]);
    expect(m.rows[1][1]).toBe('d');
    expect(m.rows[6][8]).toBe('d');
    applyOps(m, [{ op: 'clear', x: 8, y: 6, w: 1, h: 1 }]);
    expect(m.rows[6][8]).toBe('.');
    expect(m.props).toEqual([]);
  });

  it('validates input with helpful errors', () => {
    const m = newMap('t', 'T', 'battle', 8, 8);
    expect(() => applyOps(m, [{ op: 'fill', x: 0, y: 0, w: 2, h: 2, floor: 'lavaa' }])).toThrow(/Unknown floor/);
    expect(() => applyOps(m, [{ op: 'fill', x: 20, y: 20, w: 2, h: 2, floor: 'stone' }])).toThrow(/outside/);
    expect(() => applyOps(m, [{ op: 'prop', kind: 'dragon' as any, x: 1, y: 1 }])).toThrow(/Unknown prop/);
  });

  it('renders preview and control images that rasterize, at a latent-friendly size', () => {
    const m = newMap('t', 'T', 'battle', 20, 14);
    applyOps(m, [{ op: 'room', x: 2, y: 2, w: 8, h: 6, name: 'Hall' }, { op: 'door', x: 5, y: 2, side: 'n' }, { op: 'prop', kind: 'table', x: 4, y: 4, w: 2, h: 1 }]);
    const { w, h } = imageSize(m);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(Math.max(w, h)).toBeLessThanOrEqual(1344 + 16);
    const control = renderSvg(m, 'control');
    expect(control).not.toContain('<text'); // no text for the diffusion model to paint
    expect(renderSvg(m, 'preview')).toContain('Hall');
    const png = toPng(control);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('region maps render shapes and persist with history', () => {
    const maps = new Maps(dir);
    const m = maps.create('Coast', 'region');
    applyOps(m, [
      { op: 'shape', type: 'polygon', kind: 'sea', points: [[0, 0], [400, 0], [400, 300], [0, 300]], id: 'sea' },
      { op: 'shape', type: 'path', kind: 'road', points: [[500, 400], [700, 420]] },
      { op: 'shape', type: 'pin', kind: 'city', points: [[700, 420]], label: 'Greywater' },
    ]);
    maps.save(m);
    expect(renderSvg(m, 'control')).toContain('polyline');
    expect(maps.get(m.id).shapes).toHaveLength(3);
    maps.save({ ...m, name: 'Coast v2' }); // second save creates a history snapshot
    expect(fs.readdirSync(path.join(dir, '.history')).length).toBe(2); // each explicit save snapshots the previous file
    expect(() => maps.get('nope')).toThrow(/No such map/);
  });
});

// ---------------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------------
import { runCommand } from '../src/commands.js';
import { Comfy } from '../src/comfy.js';
import { ImageService } from '../src/images.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

class FakeComfy extends Comfy {
  uploaded: string[] = [];
  graphs: any[] = [];
  async uploadImage(_b: Buffer, name: string) {
    this.uploaded.push(name);
    return name;
  }
  async generate(wf: any) {
    this.graphs.push(wf);
    await new Promise((r) => setTimeout(r, 10));
    return { bytes: Buffer.from('png'), filename: 'x.png' };
  }
}

describe('map commands', () => {
  let store: Store;
  let svc: ImageService;
  let fake: FakeComfy;
  const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
  const idle = async () => {
    for (let i = 0; i < 200 && svc.jobs.some((j) => j.status === 'queued' || j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
  };

  beforeEach(() => {
    store = new Store(new Persistence(dir));
    fake = new FakeComfy();
    svc = new ImageService(store, path.join(dir, 'images'), () => {}, fake);
    store.images = svc;
  });

  it('create_map makes the map file and a location it is attached to', () => {
    const r = run('create_map', { name: 'Rusty Anchor', cols: 20, rows: 14, place: 'canvas' });
    expect(store.state.nodes[r.nodeId]).toMatchObject({ type: 'location', fields: { mapId: r.mapId } });
    expect(store.state.graph.placements[r.nodeId]).toBeDefined();
    expect(store.maps.get(r.mapId).grid).toMatchObject({ cols: 20, rows: 14, unit: 6 });
    expect(run('list_maps')[0]).toMatchObject({ mapId: r.mapId, nodeId: r.nodeId });
  });

  it('edit_map applies ops, broadcasts, and is all-or-nothing', () => {
    const { mapId } = run('create_map', { name: 'T', cols: 16, rows: 12 });
    const seen: string[] = [];
    store.onMap((m, actor) => seen.push(`${actor}:${m.id}`));
    run('edit_map', { mapId, ops: [{ op: 'room', x: 2, y: 2, w: 6, h: 4, name: 'Hall' }, { op: 'door', x: 4, y: 2, side: 'n' }, { op: 'prop', kind: 'table', x: 4, y: 4, w: 2 }] });
    expect(seen).toEqual([`claude:${mapId}`]);
    expect(store.maps.get(mapId).rows[2].slice(2, 8)).toBe('ssssss');
    const view = run('get_map', { mapId }).view as string;
    expect(view).toContain('Battle map "T" 16x12');
    expect(view).toContain('doors: 4,2/n:door');
    // a bad op in the middle: nothing from this call is saved
    expect(() => run('edit_map', { mapId, ops: [{ op: 'room', x: 9, y: 2, w: 3, h: 3 }, { op: 'fill', x: 0, y: 0, w: 2, h: 2, floor: 'custard' }] })).toThrow(/Unknown floor/);
    expect(store.maps.get(mapId).rows[2][10]).toBe('.');
    // schema validation rejects nonsense before touching anything
    expect(() => run('edit_map', { mapId, ops: [{ op: 'explode' }] })).toThrow();
  });

  it('render_map uploads the control image, runs img2img, and attaches the result', async () => {
    const { mapId, nodeId } = run('create_map', { name: 'Cellar', cols: 12, rows: 10 });
    run('edit_map', { mapId, ops: [{ op: 'room', x: 1, y: 1, w: 8, h: 6, floor: 'stone' }] });
    const r = run('render_map', { mapId, prompt: 'A damp stone wine cellar lit by torches', fidelity: 'faithful', seed: 7 });
    expect(r.denoise).toBe(0.62);
    await idle();
    expect(fake.uploaded).toEqual([`pnp-${mapId}.png`]);
    const wf = fake.graphs[0];
    expect(wf['13'].inputs.denoise).toBe(0.62);
    expect(wf['13'].inputs.latent_image).toEqual(['21', 0]); // starts from the encoded layout, not an empty latent
    expect(wf['12']).toBeUndefined();
    expect(wf['10'].inputs.text).toContain('damp stone wine cellar');
    expect(wf['10'].inputs.text).toContain('top-down'); // map style, not the cinematic campaign style
    expect(store.maps.get(mapId).renders).toEqual([`${nodeId}-7.png`]);
    expect(store.state.nodes[nodeId].images).toEqual([`${nodeId}-7.png`]);
  });

  it('render_map needs a map node', () => {
    const m = store.maps.create('Orphan', 'battle');
    expect(() => run('render_map', { mapId: m.id, prompt: 'some stone place' })).toThrow(/not attached/);
  });
});

describe('moving and editing parts of a map', () => {
  const build = () => {
    const m = newMap('t', 't', 'battle', 20, 12);
    applyOps(m, [
      { op: 'room', x: 1, y: 1, w: 5, h: 4, floor: 'wood', name: 'Hall' },
      { op: 'prop', kind: 'table', x: 2, y: 2, w: 2, h: 1, id: 'tbl' },
      { op: 'token', x: 4, y: 3, kind: 'enemy', label: 'E1' },
      { op: 'door', x: 5, y: 2, side: 'e' },
      { op: 'room', x: 7, y: 1, w: 3, h: 4, floor: 'stone' },
    ]);
    return m;
  };

  it('move_area carries floor, props, tokens, labels and the door; the old place becomes rock', () => {
    const m = build();
    applyOps(m, [{ op: 'move_area', x: 1, y: 1, w: 5, h: 4, dx: 0, dy: 6 }]);
    expect(cellAt(m, 1, 1)).toBe('.');
    expect(cellAt(m, 2, 7)).toBe('w');
    expect(m.props.find((p) => p.id === 'tbl')).toMatchObject({ x: 2, y: 8 });
    expect(m.tokens[0]).toMatchObject({ x: 4, y: 9 });
    expect(m.labels[0].y).toBeGreaterThan(6);
    expect(m.doors.some((d) => d.y === 8)).toBe(true);
    expect(m.doors.some((d) => d.y === 2)).toBe(false);
    expect(cellAt(m, 8, 2)).toBe('s'); // the neighbouring room stayed
  });

  it('copy keeps the original and gives copied props new ids; leaving the grid is refused', () => {
    const m = build();
    applyOps(m, [{ op: 'move_area', x: 1, y: 1, w: 5, h: 4, dx: 0, dy: 6, copy: true }]);
    expect(cellAt(m, 2, 2)).toBe('w');
    expect(cellAt(m, 2, 7)).toBe('w');
    expect(m.props).toHaveLength(2);
    expect(new Set(m.props.map((p) => p.id)).size).toBe(2);
    expect(() => applyOps(build(), [{ op: 'move_area', x: 1, y: 1, w: 5, h: 4, dx: 0, dy: 20 }])).toThrow(/leave the/);
  });

  it('moving onto another room leaves its floor alone where the moved area is rock', () => {
    const m = build();
    applyOps(m, [{ op: 'move_area', x: 0, y: 0, w: 7, h: 6, dx: 6, dy: 0 }]); // hall (+ its rock margin) onto the stone room
    expect(cellAt(m, 8, 1)).toBe('w'); // overwritten by the hall's wood
    expect(cellAt(m, 13, 5)).toBe('.');
  });

  it('edit_prop / edit_token / edit_label change single things', () => {
    const m = build();
    applyOps(m, [
      { op: 'edit_prop', id: 'tbl', x: 3, y: 3, w: 1, h: 2, label: 'Bar' },
      { op: 'edit_token', x: 4, y: 3, to: [5, 4], label: 'Boss' },
      { op: 'edit_label', x: m.labels[0].x, y: m.labels[0].y, text: 'Great hall' },
    ]);
    expect(m.props[0]).toMatchObject({ x: 3, y: 3, w: 1, h: 2, label: 'Bar' });
    expect(m.tokens[0]).toMatchObject({ x: 5, y: 4, label: 'Boss' });
    expect(m.labels[0].text).toBe('Great hall');
    expect(() => applyOps(m, [{ op: 'edit_prop', id: 'nope', x: 1 }])).toThrow(/No prop/);
    expect(() => applyOps(m, [{ op: 'edit_token', x: 0, y: 0 }])).toThrow(/No token/);
  });
});
