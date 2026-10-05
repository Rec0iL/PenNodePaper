import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageJob, MapPaintMode } from '@pnp/shared';
import { Comfy, ComfyError } from '../src/comfy.js';
import { runCommand } from '../src/commands.js';
import { ImageService } from '../src/images.js';
import { cropFor, DISCRETE_PROPS, describeGroups, groupMasks, groupProps, MASK } from '../src/maps.js';
import { applyOps, imageSize, newMap, renderSvg, terrainLegend, toPng } from '../src/maps.js';
import { fallbackGroupPrompt, groupPromptRequest, parseGroupPrompts, shellRequest, terrainDenoise } from '../src/mappaint.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

// ---- pure parts ------------------------------------------------------------------------------

const tavern = () => {
  const m = newMap('t', 'Tavern', 'battle', 24, 16);
  applyOps(m, [
    { op: 'room', x: 2, y: 2, w: 13, h: 10, floor: 'wood', name: 'Taproom' },
    { op: 'room', x: 15, y: 2, w: 7, h: 5, floor: 'stone', name: 'Kitchen' },
    { op: 'door', x: 7, y: 11, side: 's' },
    { op: 'prop', kind: 'table', x: 5, y: 5, w: 1, h: 1, id: 'a' }, { op: 'prop', kind: 'table', x: 6, y: 5, w: 1, h: 1, id: 'b' }, { op: 'prop', kind: 'table', x: 7, y: 5, w: 1, h: 1, id: 'c' },
    ...[3, 4, 5, 6, 7].map((x): any => ({ op: 'prop', kind: 'barrel', x, y: 10 })),
    { op: 'prop', kind: 'chair', x: 5, y: 4 }, { op: 'prop', kind: 'chair', x: 6, y: 4 },
    { op: 'prop', kind: 'cauldron', x: 17, y: 3 },
    { op: 'prop', kind: 'table', x: 19, y: 3, w: 2, h: 1, id: 'far' },
    { op: 'label', x: 8, y: 2.7, text: 'Taproom' },
  ]);
  return m;
};

describe('prop groups', () => {
  it('touching props of the same kind are ONE group; other kinds and gaps stay apart', () => {
    const g = groupProps(tavern());
    const by = (k: string) => g.filter((x) => x.kind === k);
    expect(by('table').map((x) => x.props.length).sort()).toEqual([1, 3]); // three touching tables = one long table, the far one alone
    expect(by('barrel')).toHaveLength(1);
    expect(by('barrel')[0].props).toHaveLength(5);
    expect(by('chair')[0].props).toHaveLength(2); // chairs touch the table row but are a different kind
    expect(g).toHaveLength(5);
  });

  it('big groups come first and ids are g1, g2, …', () => {
    const g = groupProps(tavern());
    expect(g.map((x) => x.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    const area = (x: (typeof g)[number]) => (x.bbox.x1 - x.bbox.x0) * (x.bbox.y1 - x.bbox.y0);
    for (let i = 1; i < g.length; i++) expect(area(g[i - 1])).toBeGreaterThanOrEqual(area(g[i]));
  });

  it('a quarter-turned prop occupies its rotated extent', () => {
    const m = newMap('r', 'R', 'battle', 12, 12);
    applyOps(m, [{ op: 'prop', kind: 'boat', x: 2, y: 2, w: 2, h: 4, rot: 90 }]);
    const [g] = groupProps(m);
    expect(g.bbox.x1 - g.bbox.x0).toBeCloseTo(4);
    expect(g.bbox.y1 - g.bbox.y0).toBeCloseTo(2);
  });

  it('describes each group for the AI: size, floor underneath, where it stands', () => {
    const m = tavern();
    const info = describeGroups(m);
    const barrels = info.find((i) => i.kind === 'barrel')!;
    expect(barrels).toMatchObject({ count: 5, extentCells: '5x1', extentFeet: '30x6 ft', floorUnder: 'wood' });
    expect(info.find((i) => i.kind === 'cauldron')!.floorUnder).toBe('stone');
    expect(info.find((i) => i.kind === 'table' && i.count === 1 && i.extentCells === '2x1')!.position).toContain('free-standing');
  });
});

describe('crop windows and masks', () => {
  it('crop windows sit inside the picture on the latent grid and are scaled to a workable size', () => {
    const m = tavern();
    const { w: W, h: H, cell } = imageSize(m);
    for (const g of groupProps(m)) {
      const c = cropFor(g, cell, W, H);
      for (const v of [c.w, c.h, c.tw, c.th]) expect(v % 16).toBe(0);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(W);
      expect(c.y + c.h).toBeLessThanOrEqual(H);
      expect(Math.max(c.tw, c.th)).toBeLessThanOrEqual(768 + 16);
      // the group is inside its window
      expect(g.bbox.x0 * cell).toBeGreaterThanOrEqual(c.x - 1);
      expect(g.bbox.x1 * cell).toBeLessThanOrEqual(c.x + c.w + 1);
    }
  });

  it('a row of discrete items gets separate blobs (so the model paints the right count); one object stays one blob', () => {
    const m = tavern();
    const { w: W, h: H, cell } = imageSize(m);
    const groups = groupProps(m);
    const barrels = groups.find((g) => g.kind === 'barrel')!;
    expect(DISCRETE_PROPS.has('barrel')).toBe(true);
    const sample = groupMasks(barrels, cropFor(barrels, cell, W, H), cell).sample;
    const rx = [...sample.matchAll(/<ellipse[^>]*rx="([\d.]+)"/g)].map((x) => +x[1]);
    expect(rx).toHaveLength(5);
    expect(Math.max(...rx)).toBeLessThan(cell / 2); // shrunk: neighbours do not merge
    const table = groups.find((g) => g.kind === 'table' && g.props.length === 3)!;
    const t = groupMasks(table, cropFor(table, cell, W, H), cell).sample;
    expect([...t.matchAll(/<rect x="-/g)]).toHaveLength(3);
    expect(t).toContain(`rx="`); // rounded footprints, grown by the paint margin
    expect(MASK.grow).toBeGreaterThan(0);
  });

  it('the masks rasterize to PNGs of the sizes the workflow expects', () => {
    const m = tavern();
    const { w: W, h: H, cell } = imageSize(m);
    for (const g of groupProps(m)) {
      const c = cropFor(g, cell, W, H);
      const { sample, compose } = groupMasks(g, c, cell);
      expect(sample).toContain(`width="${c.tw}" height="${c.th}"`);
      expect(compose).toContain(`width="${c.w}" height="${c.h}"`);
      expect(toPng(sample).subarray(1, 4).toString()).toBe('PNG');
      expect(toPng(compose).subarray(1, 4).toString()).toBe('PNG');
    }
  });
});

describe('terrain picture', () => {
  it('has floors, walls and doors but no props, labels or tokens', () => {
    const m = tavern();
    const terrain = renderSvg(m, 'terrain');
    const control = renderSvg(m, 'control');
    expect(terrain).not.toContain('<text');
    expect(terrain.length).toBeLessThan(control.length); // the props are missing
    expect(terrain).not.toContain('#c8782d'); // table colour
    expect(terrain).toContain('#d9822b'); // the door
    expect(control).toContain('#c8782d');
    expect(toPng(terrain).subarray(1, 4).toString()).toBe('PNG');
  });

  it('the legend names only the floors the map uses (a legend for absent materials makes the model invent them)', () => {
    const l = terrainLegend(tavern());
    expect(l).toContain('wooden floor');
    expect(l).toContain('stone floor');
    expect(l).not.toContain('marble');
    expect(l).not.toContain('water');
    expect(l).toContain('EMPTY');
  });

  it('maps with few walls get a little less freedom than walled ones', () => {
    const walled = tavern();
    const open = newMap('o', 'O', 'battle', 24, 16);
    applyOps(open, [{ op: 'fill', x: 0, y: 8, w: 24, h: 8, floor: 'water' }, { op: 'fill', x: 0, y: 0, w: 24, h: 8, floor: 'sand' }]);
    for (let i = 0; i < 24; i++) applyOps(open, [{ op: 'open', x: i, y: 0, side: 'n' }, { op: 'open', x: i, y: 15, side: 's' }]);
    for (let j = 0; j < 16; j++) applyOps(open, [{ op: 'open', x: 0, y: j, side: 'w' }, { op: 'open', x: 23, y: j, side: 'e' }]); // an open shore: no walls to hold on to
    expect(terrainDenoise(walled)).toBe(0.72);
    expect(terrainDenoise(open)).toBeLessThan(0.72);
    expect(terrainDenoise(walled, 'faithful')).toBeLessThan(terrainDenoise(walled, 'painterly'));
  });
});

describe('prompts for the AI', () => {
  it('the request carries the place and every group; the shell request asks for nothing inside', () => {
    const m = tavern();
    const infos = describeGroups(m);
    const req = groupPromptRequest('A rough harbour tavern.', infos);
    expect(req).toContain('A rough harbour tavern.');
    for (const i of infos) expect(req).toContain(`"id":"${i.id}"`);
    expect(req).toMatch(/CONTRAST/);
    expect(req).toMatch(/exactly how many/);
    expect(shellRequest(m, 'A rough harbour tavern.')).toMatch(/nothing inside/);
    expect(shellRequest(m, 'x')).toContain('wood');
  });

  it('parses an answer wrapped in fences and fills gaps with a plain prompt for the kind', () => {
    const infos = describeGroups(tavern());
    const r = parseGroupPrompts('```json\n{"g1": "A long scarred oak table with tankards", "g2": "x"}\n```', infos);
    expect(r.prompts.g1).toBe('A long scarred oak table with tankards');
    expect(r.prompts.g2).toBe(fallbackGroupPrompt(infos[1])); // too short -> fallback
    expect(r.fromAi).toBe(1);
    expect(Object.keys(r.prompts)).toHaveLength(infos.length);
    expect(parseGroupPrompts('not json at all', infos).fromAi).toBe(0);
    expect(fallbackGroupPrompt({ kind: 'barrel', count: 5 })).toContain('5 separate');
  });
});

// ---- the whole precise flow against a fake ComfyUI ---------------------------------------------

let dir: string;
let store: Store;
let svc: ImageService;
let seen: ImageJob[];
let wfs: any[];
let fail: string | null;
let mode: MapPaintMode;
let aiCalls: string[];
let aiMode: 'ok' | 'down';
let delay = 5;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

class FakeComfy extends Comfy {
  uploaded = 0;
  async uploadImage(_b: Buffer, name: string) {
    this.uploaded++;
    return name;
  }
  async generate(wf: any, opts: any) {
    wfs.push(wf);
    opts.onProgress?.(0.5);
    await new Promise((r) => setTimeout(r, delay));
    if (opts.signal?.aborted) throw new ComfyError('Cancelled.');
    if (fail) throw new ComfyError(fail);
    return { bytes: Buffer.from(`png-${wfs.length}`), filename: 'x.png' };
  }
}

const idle = async () => {
  for (let i = 0; i < 400 && svc.jobs.some((j) => j.status === 'queued' || j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-paint-'));
  store = new Store(new Persistence(dir));
  seen = [];
  wfs = [];
  fail = null;
  mode = 'staged';
  aiCalls = [];
  aiMode = 'ok';
  delay = 5;
  svc = new ImageService(store, path.join(dir, 'images'), (j) => seen.push(j), new FakeComfy(), {
    mapMode: () => mode,
    ai: async (_backend, prompt) => {
      aiCalls.push(prompt);
      if (aiMode === 'down') throw new Error('claude is not installed');
      if (prompt.includes('GROUPS (JSON)')) {
        const ids = [...prompt.matchAll(/"id":"(g\d+)"/g)].map((x) => x[1]);
        return JSON.stringify(Object.fromEntries(ids.map((id) => [id, `AI says: a detailed object for ${id}`])));
      }
      return 'Bare stone-walled building with a plank floor, nothing inside.';
    },
  });
  store.images = svc;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup() {
  run('create_node', { id: 'inn', type: 'location', title: 'The Rusty Anchor', summary: 'A tavern.' });
  const { mapId } = run('create_map', { name: 'Inn floor', nodeId: 'inn', cols: 16, rows: 12 });
  const m = store.maps.get(mapId);
  applyOps(m, [
    { op: 'room', x: 2, y: 2, w: 10, h: 7, floor: 'wood' },
    { op: 'prop', kind: 'table', x: 4, y: 4, w: 2, h: 1 }, { op: 'prop', kind: 'table', x: 6, y: 4, w: 2, h: 1 },
    { op: 'prop', kind: 'barrel', x: 3, y: 7 }, { op: 'prop', kind: 'barrel', x: 4, y: 7 },
    { op: 'prop', kind: 'chest', x: 10, y: 3 },
  ]);
  store.maps.save(m, { backup: 'none' });
  return mapId as string;
}
const PLACE = 'A rough harbour tavern with worn planks and lantern light';

describe('precise painting (two steps)', () => {
  it('step 1 paints only the empty terrain: a layout-only picture, an AI-written empty-shell prompt, the candidate stays with the map and off the node', async () => {
    const mapId = setup();
    const r = run('render_map', { mapId, prompt: PLACE, seed: 7 });
    expect(r.step).toMatch(/1 of 2/);
    expect(r.note).toMatch(/takes a while/);
    await idle();
    expect(wfs).toHaveLength(1);
    const wf = wfs[0];
    expect(wf['20'].class_type).toBe('LoadImage'); // img2img from the uploaded terrain picture
    expect(wf['20'].inputs.image).toBe('pnp-' + mapId + '-terrain.png');
    expect(wf['13'].inputs.denoise).toBeCloseTo(0.72, 2);
    const prompt = wf['10'].inputs.text as string;
    expect(prompt).toContain('nothing inside'); // the AI's shell text, not the GM's tavern wording
    expect(prompt).toContain('completely empty');
    expect(prompt).toContain('EMPTY, unfurnished'); // terrain legend
    expect(prompt).not.toContain('tavern');
    const m = store.maps.get(mapId);
    expect(m.terrains).toHaveLength(1);
    expect(m.terrains![0]).toMatch(/terrain/);
    expect(m.terrainPick).toBeUndefined(); // the GM picks
    expect(m.paintPrompt).toBe(PLACE);
    expect(store.state.nodes.inn.images).toEqual([]); // work in progress is not a picture of the place
    expect(m.renders).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'images', m.terrains![0]))).toBe(true);
    expect(seen.some((j) => j.phase === 'Describing the empty place…')).toBe(true);
    expect(seen.some((j) => j.phase === 'Painting the terrain…')).toBe(true);
  });

  it('falls back to the GM text plus "completely empty" when the AI is not available', async () => {
    const mapId = setup();
    aiMode = 'down';
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    const prompt = wfs[0]['10'].inputs.text as string;
    expect(prompt).toContain('A rough harbour tavern');
    expect(prompt).toMatch(/Completely empty, bare floors, nothing inside/);
  });

  it('step 2 needs a picked terrain, then inpaints each prop group in turn and adds one finished picture', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    wfs.length = 0;
    expect(() => run('paint_map_props', { mapId })).toThrow(/No terrain picked/);
    const terrain = store.maps.get(mapId).terrains![0];
    expect(() => run('set_map_terrain', { mapId, file: 'nope.png' })).toThrow(/not one of/);
    run('set_map_terrain', { mapId, file: terrain });
    expect(store.maps.get(mapId).terrainPick).toBe(terrain);

    const r = run('paint_map_props', { mapId, seed: 100 });
    expect(r.groups).toBe(3); // one long table (2 touching), 2 barrels in a row, a chest
    expect(r.estimate).toMatch(/min/);
    await idle();
    expect(wfs).toHaveLength(3);
    for (const wf of wfs) {
      expect(wf['21'].class_type).toBe('ImageCrop');
      expect(wf['25'].class_type).toBe('SetLatentNoiseMask');
      expect(wf['28'].class_type).toBe('ImageCompositeMasked');
      expect(wf['13'].inputs.denoise).toBe(1);
      expect(wf['15'].inputs.images).toEqual(['28', 0]);
      expect(wf['10'].inputs.text).toMatch(/AI says: a detailed object for g\d/);
      expect(wf['10'].inputs.text).toMatch(/thick dark ink outline/);
    }
    expect(new Set(wfs.map((w) => w['13'].inputs.seed)).size).toBe(3); // each group its own seed
    expect(wfs.every((w) => w['21'].inputs.width % 16 === 0 && w['22'].inputs.width % 16 === 0)).toBe(true);
    // the result is a normal render of the map: node picture + map render
    const m = store.maps.get(mapId);
    expect(m.renders).toHaveLength(1);
    expect(store.state.nodes.inn.images).toEqual(m.renders);
    // progress and phase reporting for the UI
    const job = seen.filter((j) => j.status === 'running' || j.status === 'done');
    expect(job.some((j) => /Painting props 2\/3/.test(j.phase ?? ''))).toBe(true);
    expect(job.some((j) => /Writing the painting prompts/.test(j.phase ?? ''))).toBe(true);
    expect(Math.max(...job.map((j) => j.progress))).toBe(1);
    expect(seen.at(-1)!.status).toBe('done');
    // the AI got the groups (as data) and the place
    const req = aiCalls.find((c) => c.includes('GROUPS (JSON)'))!;
    expect(req).toContain(PLACE);
    expect(req).toContain('"kind":"barrel"');
  });

  it('plain prompts per kind are used when the AI is down; given prompts skip the AI', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    wfs.length = 0;
    aiMode = 'down';
    run('paint_map_props', { mapId });
    await idle();
    expect(wfs).toHaveLength(3);
    expect(wfs.map((w) => w['10'].inputs.text).join('|')).toMatch(/oak barrels/);
    expect(wfs.map((w) => w['10'].inputs.text).join('|')).not.toMatch(/AI says/);
    // explicit prompts: no AI call at all
    wfs.length = 0;
    aiCalls.length = 0;
    aiMode = 'ok';
    run('paint_map_props', { mapId, prompts: { g1: 'my own long table description' } });
    await idle();
    expect(aiCalls).toEqual([]);
    expect(wfs.map((w) => w['10'].inputs.text).join('|')).toContain('my own long table description');
  });

  it('can be stopped between groups; nothing half-done is attached', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    wfs.length = 0;
    const r = run('paint_map_props', { mapId });
    await new Promise((res) => setTimeout(res, 25));
    svc.cancel(r.queued[0].jobId);
    await idle();
    expect(wfs.length).toBeLessThan(3);
    expect(svc.jobs.at(-1)!.status).toBe('cancelled');
    expect(store.maps.get(mapId).renders).toEqual([]);
    expect(store.state.nodes.inn.images).toEqual([]);
  });

  it('accept_map_terrain makes a terrain the finished picture (maps without props); maps without props cannot do step 2', async () => {
    run('create_node', { id: 'cave', type: 'location', title: 'Cave', summary: 'A cave.' });
    const { mapId } = run('create_map', { name: 'Cave', nodeId: 'cave', cols: 10, rows: 8 });
    const m = store.maps.get(mapId);
    applyOps(m, [{ op: 'room', x: 1, y: 1, w: 6, h: 5, floor: 'dirt' }]);
    store.maps.save(m, { backup: 'none' });
    run('render_map', { mapId, prompt: 'A damp cave with dripping stone' });
    await idle();
    const t = store.maps.get(mapId).terrains![0];
    run('set_map_terrain', { mapId, file: t });
    expect(() => run('paint_map_props', { mapId })).toThrow(/no props/);
    run('accept_map_terrain', { mapId });
    expect(store.maps.get(mapId).renders).toEqual([t]);
    expect(store.state.nodes.cave.images).toEqual([t]);
  });

  it('get_map reports the mode and the terrain state to the AI', async () => {
    const mapId = setup();
    expect(run('get_map', { mapId })).toMatchObject({ paintMode: 'staged', terrains: [], terrainPick: null, propGroups: 3 });
    mode = 'quick';
    expect(run('get_map', { mapId }).paintMode).toBe('quick');
  });
});

describe('quick painting is unchanged', () => {
  it('one img2img pass from the control picture with props, attached like before; no terrain steps', async () => {
    mode = 'quick';
    const mapId = setup();
    const r = run('render_map', { mapId, prompt: PLACE, fidelity: 'balanced' });
    expect(r.denoise).toBe(0.7);
    await idle();
    expect(wfs).toHaveLength(1);
    expect(wfs[0]['10'].inputs.text).toContain('Input is a flat colour-coded top-down floor plan'); // CONTROL_LEGEND
    expect(wfs[0]['10'].inputs.text).toContain('tavern');
    const m = store.maps.get(mapId);
    expect(m.renders).toHaveLength(1);
    expect(m.terrains ?? []).toEqual([]);
    expect(store.state.nodes.inn.images).toEqual(m.renders);
    expect(aiCalls).toEqual([]); // no AI involved
  });

  it('region maps always use the quick way', async () => {
    run('create_node', { id: 'coast', type: 'location', title: 'Coast', summary: 'A coast.' });
    const { mapId } = run('create_map', { name: 'Coast', nodeId: 'coast', kind: 'region' });
    run('render_map', { mapId, prompt: 'A rugged northern coastline in autumn' });
    await idle();
    expect(store.maps.get(mapId).renders).toHaveLength(1);
    expect(store.maps.get(mapId).terrains ?? []).toEqual([]);
  });
});

describe('time estimates', () => {
  it('start as a typical-card guess and turn into measurements once an image has been made', async () => {
    const mapId = setup();
    const m = store.maps.get(mapId);
    const before = svc.estimateSeconds(1);
    expect(before.measured).toBe(false);
    expect(before.seconds).toBeGreaterThan(30);
    expect(before.seconds).toBeLessThan(300);
    mode = 'quick';
    delay = 520; // timings under half a second are ignored as noise
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    const after = svc.estimateSeconds(1);
    expect(after.measured).toBe(true);
    expect(after.seconds).not.toBe(before.seconds);
    expect(m.kind).toBe('battle');
  });
});
