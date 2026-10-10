import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { charactersOfPlace } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { buildBundle, kinetikSession } from '../src/vtt.js';
import { connectMockVtt, KINETIK_LIKE_PROFILE } from '../scripts/mock-vtt.js';

// An NPC or enemy that belongs to a place can stand on its battle map as a token: pushing the map sends the sheet along.
let dir: string;
let store: Store;
let server: http.Server;
let url: string;
let clients: { close: () => void }[] = [];
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!f()) throw new Error('timed out');
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-cast-'));
  store = new Store(new Persistence(dir));
  fs.mkdirSync(store.imagesDir, { recursive: true });
  server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/bridge' });
  wss.on('connection', (ws) => store.vtt.accept(ws));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/bridge`;
});
afterEach(async () => {
  clients.forEach((c) => c.close());
  clients = [];
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** a tavern with a map, a brute (enemy, goon tier), a barkeep (NPC) and a "ghost" enemy with a sheet the VTT rejects */
function tavern() {
  const place = run('create_node', { type: 'location', title: 'Tavern', place: 'canvas' }).id;
  const { mapId } = run('create_map', { name: 'Tavern', nodeId: place, cols: 12, rows: 10 });
  run('edit_map', { mapId, ops: [{ op: 'room', x: 1, y: 1, w: 8, h: 6 }] });
  const brute = run('create_node', { type: 'enemy', title: 'Dockside Brute', linkTo: place, linkKind: 'belongs-to', fields: { role: 'enemy', sheet: { tier: 'goon', count: 3, level: 0 } } }).id;
  const brenn = run('create_node', { type: 'npc', title: 'Brenn', linkTo: place, linkKind: 'belongs-to', fields: { sheet: { note: 'Barkeep', size: 1 } } }).id;
  const ghost = run('create_node', { type: 'enemy', title: 'Ghost', linkTo: place, linkKind: 'belongs-to', fields: { sheet: { tier: 'dragon' } } }).id; // a sheet the VTT rejects
  const stranger = run('create_node', { type: 'npc', title: 'Stranger' }).id; // does not belong anywhere
  return { place, mapId, brute, brenn, ghost, stranger };
}

describe('characters on a battle map', () => {
  it('lists who belongs to the place, and tokens can stand for them (kind and name come from the node)', () => {
    const t = tavern();
    expect(charactersOfPlace(store.state, t.mapId).map((n) => n.id).sort()).toEqual([t.brenn, t.brute, t.ghost].sort());
    expect(run('get_map', { mapId: t.mapId }).characters).toHaveLength(3);
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 2, y: 2, node: t.brute }, { op: 'token', x: 3, y: 2, node: t.brute }, { op: 'token', x: 5, y: 3, node: t.brenn, label: 'Behind the bar' }] });
    const m = store.maps.get(t.mapId);
    expect(m.tokens).toEqual([
      { x: 2, y: 2, kind: 'enemy', label: 'Dockside Brute', node: t.brute },
      { x: 3, y: 2, kind: 'enemy', label: 'Dockside Brute', node: t.brute },
      { x: 5, y: 3, kind: 'npc', label: 'Behind the bar', node: t.brenn },
    ]);
    expect(run('get_map', { mapId: t.mapId }).characters.find((c: any) => c.nodeId === t.brute).placedAt).toEqual(['2,2', '3,2']);
    // only NPC / enemy nodes can be stood for; a plain token still needs a kind
    expect(() => run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 6, y: 3, node: t.place }] })).toThrow(/not an NPC or enemy/);
    expect(() => run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 6, y: 3 }] })).toThrow(/needs a kind/);
    // tie an existing marker, cut the tie again
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 7, y: 4, kind: 'enemy', label: 'E1' }] });
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'edit_token', x: 7, y: 4, node: t.ghost }] });
    expect(store.maps.get(t.mapId).tokens.at(-1)).toMatchObject({ node: t.ghost, label: 'E1', kind: 'enemy' });
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'edit_token', x: 7, y: 4, node: null }] });
    expect(store.maps.get(t.mapId).tokens.at(-1)?.node).toBeUndefined();
  });

  it('the belongs-to connection counts whichever way it was drawn', () => {
    const t = tavern();
    const cook = run('create_node', { type: 'npc', title: 'Cook' }).id;
    run('link', { from: t.place, to: cook, kind: 'belongs-to' }); // drawn from the place to the character
    expect(charactersOfPlace(store.state, t.mapId).map((n) => n.id)).toContain(cook);
    // a location "belonging" to another one is no character
    const yard = run('create_node', { type: 'location', title: 'Yard' }).id;
    run('link', { from: yard, to: t.place, kind: 'belongs-to' });
    expect(charactersOfPlace(store.state, t.mapId).map((n) => n.id)).not.toContain(yard);
  });

  it('pushing the map sends the characters after it, tokens tied by id; a sheet the VTT rejects only leaves a plain marker', async () => {
    const c = connectMockVtt(url, KINETIK_LIKE_PROFILE);
    clients.push(c);
    await until(() => store.vtt.status().connected);
    const t = tavern();
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 2, y: 2, node: t.brute }, { op: 'token', x: 3, y: 2, node: t.brute }, { op: 'token', x: 5, y: 3, node: t.brenn }, { op: 'token', x: 6, y: 5, node: t.ghost }, { op: 'token', x: 7, y: 5, kind: 'enemy', label: 'Plain' }] });
    const r = await run('push_scene', { mapId: t.mapId, image: 'plan' });
    expect(r).toMatchObject({ pushed: 'scene', tokens: 5, linkedTokens: 3, characters: { sent: ['Dockside Brute', 'Brenn'] } });
    expect(r.characters.failed).toEqual([expect.objectContaining({ name: 'Ghost' })]); // the VTT would reject it
    expect(r.note).toMatch(/Ghost/);

    const pushes = c.received.filter((m) => m.t === 'push') as any[];
    expect(pushes.map((p) => p.kind)).toEqual(['scene', 'character', 'character']); // scene first, then the characters it names
    const scene = pushes[0].payload;
    expect(scene.tokens.map((x: any) => [x.label, x.kind, x.character])).toEqual([
      ['Dockside Brute', 'enemy', t.brute], ['Dockside Brute', 'enemy', t.brute], ['Brenn', 'npc', t.brenn], ['Ghost', 'enemy', undefined], ['Plain', 'enemy', undefined],
    ]);
    expect(pushes.slice(1).map((p) => [p.payload.id, p.payload.role, p.payload.scene])).toEqual([[t.brute, 'enemy', t.mapId], [t.brenn, 'npc', t.mapId]]);

    // the GM can send the bare map as before
    c.received.length = 0;
    expect(await run('push_scene', { mapId: t.mapId, image: 'plan', characters: false })).toMatchObject({ linkedTokens: 0, characters: { sent: [] } });
    expect(c.received.filter((m) => m.t === 'push')).toHaveLength(1);
  });

  it('a VTT that cannot receive characters still gets the map with its named tokens', async () => {
    const c = connectMockVtt(url, { ...KINETIK_LIKE_PROFILE, push: { handout: { text: true }, scene: { grids: ['square'], tokens: true } } });
    clients.push(c);
    await until(() => store.vtt.status().connected);
    const t = tavern();
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 2, y: 2, node: t.brute }] });
    const r = await run('push_scene', { mapId: t.mapId, image: 'plan' });
    expect(r).toMatchObject({ tokens: 1, linkedTokens: 0 });
    expect((c.received.find((m) => m.t === 'push') as any).payload.tokens[0]).toMatchObject({ label: 'Dockside Brute', kind: 'enemy' });
  });

  it('the offline files carry the same ties: UPF bundle and the KINETIK session', () => {
    const t = tavern();
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 2, y: 2, node: t.brute }, { op: 'token', x: 3, y: 2, node: t.brute }, { op: 'token', x: 5, y: 3, node: t.brenn }] });
    const b = buildBundle(store, store.imagesDir, { maps: [t.mapId] }, KINETIK_LIKE_PROFILE);
    expect(b.characters.map((c) => [c.id, c.scene])).toEqual([[t.brute, t.mapId], [t.brenn, t.mapId]]);
    expect(b.scenes[0].tokens.filter((x) => x.character).length).toBe(3);
    const k = kinetikSession(b) as any;
    const toks = k.session.scenes[0].tokens;
    expect(toks.filter((x: any) => x.npcId === t.brute)).toHaveLength(2); // both goons are tokens of ONE combat entry
    expect(k.session.combat.npcs.map((n: any) => n.id)).toEqual([t.brute]);
    expect(toks.find((x: any) => x.src === `pnp:${t.brenn}`)).toMatchObject({ name: 'Brenn', note: 'Barkeep' });
    expect(toks).toHaveLength(3); // the barkeep is not added a second time as a free token
  });

  it('the KINETIK session puts a boss or nemesis on the plan 2x2, like KINETIK’s own menu does', () => {
    const t = tavern();
    const boss = run('create_node', { type: 'enemy', title: 'Captain', linkTo: t.place, linkKind: 'belongs-to', fields: { role: 'enemy', sheet: { tier: 'boss', level: 8, bonus: 6 } } }).id;
    run('edit_map', { mapId: t.mapId, ops: [{ op: 'token', x: 4, y: 3, node: boss }, { op: 'token', x: 2, y: 2, node: t.brute }] });
    const b = buildBundle(store, store.imagesDir, { maps: [t.mapId] }, KINETIK_LIKE_PROFILE);
    const k = kinetikSession(b) as any;
    const sc = k.session.scenes[0];
    const g = sc.grid.size;
    const cap = sc.tokens.find((x: any) => x.npcId === boss);
    expect(cap).toMatchObject({ size: 2, x: 5 * g, y: 4 * g }); // top-left cell (4,3) stays, centre on the grid crossing
    expect(sc.tokens.find((x: any) => x.npcId === t.brute).size).toBe(1);
  });
});
