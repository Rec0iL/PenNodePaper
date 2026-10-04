import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { connectMockVtt, KINETIK_LIKE_PROFILE } from '../scripts/mock-vtt.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { renderSvg, newMap, toPng } from '../src/maps.js';
import { handoutFromNode, illustrationsOf, imageDimensions, sceneFromImage } from '../src/vtt.js';

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const png = () => toPng(renderSvg(newMap('x', 'x', 'battle', 6, 4)));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-places-'));
  store = new Store(new Persistence(dir));
  fs.mkdirSync(store.imagesDir, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const addImage = (nodeId: string, file: string) => {
  fs.writeFileSync(path.join(store.imagesDir, file), png());
  const n = store.state.nodes[nodeId];
  store.transact('user', 'img', (tx) => tx.putNode({ ...n, images: [...n.images, file] }));
};

describe('a location carries its map', () => {
  it('attaching a map keeps the node a location (with its images); a node has at most one map', () => {
    run('create_node', { id: 'tavern', type: 'location', title: 'The Rusty Anchor', summary: 'A tavern.' });
    addImage('tavern', 'tavern-art.png');
    const r = run('create_map', { name: 'Tavern floor', nodeId: 'tavern', kind: 'battle', cols: 12, rows: 8 });
    expect(store.state.nodes.tavern).toMatchObject({ type: 'location', images: ['tavern-art.png'], fields: { mapId: r.mapId } });
    expect(() => run('create_map', { name: 'again', nodeId: 'tavern' })).toThrow(/already has a map/);
    expect(run('list_maps')[0].nodeId).toBe('tavern');
  });

  it('a new map without a node creates a location, and old "map" nodes load as locations', () => {
    const r = run('create_map', { name: 'Cellar' });
    expect(store.state.nodes[r.nodeId].type).toBe('location');
    const file = path.join(dir, 'nodes', 'legacy.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nid: legacy\ntype: map\ntitle: Old map\nfields:\n  mapId: m1\n---\nbody\n`);
    const again = new Store(new Persistence(dir));
    expect(again.state.nodes.legacy.type).toBe('location');
    expect(again.state.nodes.legacy.fields.mapId).toBe('m1');
  });
});

describe('showing images to the players', () => {
  it('hands out any image of any node; the default is the cover illustration, never a painted map render', () => {
    run('create_node', { id: 'tavern', type: 'location', title: 'The Rusty Anchor', summary: 'A tavern.' });
    const r = run('create_map', { name: 'Floor', nodeId: 'tavern' });
    addImage('tavern', 'render.png');
    store.transact('user', 'render', () => { const m = store.maps.get(r.mapId); m.renders.push('render.png'); store.maps.save(m, { backup: 'none' }); });
    addImage('tavern', 'art1.png');
    addImage('tavern', 'art2.png');
    expect(illustrationsOf(store, store.state.nodes.tavern)).toEqual(['art1.png', 'art2.png']);
    expect(handoutFromNode(store, store.imagesDir, 'tavern').image!.name).toBe('art1.png');
    const pick = handoutFromNode(store, store.imagesDir, 'tavern', { image: 'art2.png', reveal: true });
    expect(pick).toMatchObject({ kind: 'image', id: 'tavern:art2.png', reveal: true });
    expect(() => handoutFromNode(store, store.imagesDir, 'tavern', { image: 'nope.png' })).toThrow(/no image/);
  });

  it('an NPC portrait or an item picture can be handed out too', () => {
    run('create_node', { id: 'brenn', type: 'npc', title: 'Brenn', summary: 'Barkeep.' });
    addImage('brenn', 'brenn.png');
    expect(handoutFromNode(store, store.imagesDir, 'brenn').image!.name).toBe('brenn.png');
  });

  it('an illustration becomes a backdrop scene: real size, no tokens, hidden grid', () => {
    run('create_node', { id: 'tavern', type: 'location', title: 'The Rusty Anchor' });
    addImage('tavern', 'art.png');
    const buf = png();
    const d = imageDimensions(buf)!;
    const sc = sceneFromImage(store, store.imagesDir, 'tavern', 'art.png', { activate: true });
    expect(sc).toMatchObject({ name: 'The Rusty Anchor', width: d.w, height: d.h, tokens: [], activate: true, grid: { hidden: true } });
    expect(() => sceneFromImage(store, store.imagesDir, 'tavern', 'x.png')).toThrow(/no image/);
  });

  it('reads the size of PNG, JPEG and WebP headers', () => {
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108000a00140301110002110103110 0ffd9'.replace(/ /g, ''), 'hex');
    expect(imageDimensions(jpeg)).toEqual({ w: 20, h: 10 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3);
    expect(imageDimensions(webp)).toEqual({ w: 100, h: 50 });
    expect(imageDimensions(Buffer.from('nope'))).toBeNull();
  });
});

describe('pushing through a connected VTT', () => {
  it('sends the chosen picture as a handout and another one as a grid-less backdrop', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/bridge' });
    wss.on('connection', (ws) => store.vtt.accept(ws));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/bridge`;
    const mock = connectMockVtt(url, KINETIK_LIKE_PROFILE, () => {});
    for (let i = 0; i < 300 && !store.vtt.status().connected; i++) await new Promise((r) => setTimeout(r, 10));
    try {
      run('create_node', { id: 'tavern', type: 'location', title: 'The Rusty Anchor', summary: 'A tavern.' });
      addImage('tavern', 'a.png');
      addImage('tavern', 'b.png');
      await run('push_handout', { nodeId: 'tavern', image: 'b.png' });
      await run('push_scene', { nodeId: 'tavern', imageFile: 'a.png', activate: true });
      const handout = mock.received.find((m: any) => m.kind === 'handout') as any;
      const scene = mock.received.find((m: any) => m.kind === 'scene') as any;
      expect(handout.payload).toMatchObject({ id: 'tavern:b.png', kind: 'image', image: { name: 'b.png' } });
      expect(scene.payload).toMatchObject({ id: 'tavern:a.png', tokens: [], activate: true, grid: { hidden: true } });
    } finally {
      mock.close();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('thumbnails', () => {
  it('makes a small cached copy (or says it cannot) and snaps widths up', async () => {
    const { thumbnail, snapWidth } = await import('../src/thumbs.js');
    expect(snapWidth(100)).toBe(160);
    expect(snapWidth(240)).toBe(240);
    expect(snapWidth(5000)).toBe(720);
    fs.writeFileSync(path.join(store.imagesDir, 'big.png'), toPng(renderSvg(newMap('x', 'x', 'battle', 20, 20)), 900));
    const t = await thumbnail(store.imagesDir, 'big.png', 160);
    if (t === null) return; // ImageMagick not installed: the server serves the original
    const buf = fs.readFileSync(t);
    expect(buf.subarray(0, 4).toString()).toBe('RIFF');
    expect(buf.subarray(8, 12).toString()).toBe('WEBP');
    expect(buf.length).toBeLessThan(fs.statSync(path.join(store.imagesDir, 'big.png')).size);
    expect(await thumbnail(store.imagesDir, 'big.png', 160)).toBe(t); // cached
    expect(await thumbnail(store.imagesDir, 'missing.png', 160)).toBeNull();
  });
});
