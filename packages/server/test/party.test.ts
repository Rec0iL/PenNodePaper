import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { UpfCharacter } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { knowledgeBlock } from '../src/chat.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { connectMockVtt, PARTY_PROFILE } from '../scripts/mock-vtt.js';
import { renderSvg, newMap, toPng } from '../src/maps.js';

let dir: string;
let store: Store;
let server: http.Server;
let url: string;
let clients: { close: () => void }[] = [];
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!f()) throw new Error('timed out');
};
const pcs = () => Object.values(store.state.nodes).filter((n) => n.type === 'pc');
const portrait = () => ({ name: 'p.png', mime: 'image/png', b64: toPng(renderSvg(newMap('x', 'x', 'battle', 4, 4))).toString('base64') });

const jin = (over: Partial<UpfCharacter['sheet']> = {}, extra: Partial<UpfCharacter> = {}): UpfCharacter => ({
  id: 'p1', role: 'pc', name: 'Jin Yamada', playerName: 'Sam', online: true,
  sheet: { concept: 'Ex-courier turned fixer', fokus: 4, gewalt: 2, wk: 7, tags: ['Narbe'], moves: [{ name: 'Rear-Naked Choke', text: 'Würgegriff.' }], ...over }, ...extra,
});
const mia = (): UpfCharacter => ({ id: 'p2', role: 'pc', name: 'Mia Cho', playerName: 'Lena', online: false, sheet: { concept: 'Hacker', fokus: 5, gewalt: 0, wk: 5 } });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-party-'));
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

const connect = async (party: UpfCharacter[]) => {
  const c = connectMockVtt(url, PARTY_PROFILE, () => {}, party);
  clients.push(c);
  await until(() => store.vtt.status().connected);
  return c;
};

describe('party sync', () => {
  it('pulls the players’ characters on connect and saves them as nodes (with portrait)', async () => {
    await connect([jin({}, { portrait: portrait() }), mia()]);
    await until(() => pcs().length === 2);
    const n = store.state.nodes['pc-kinetik-vtt-p1'];
    expect(n).toMatchObject({ type: 'pc', title: 'Jin Yamada', summary: 'Played by Sam' });
    expect(n.fields).toMatchObject({ source: 'kinetik-vtt', vttId: 'p1', role: 'pc', playerName: 'Sam', online: true, present: true });
    expect((n.fields.sheet as any).fokus).toBe(4);
    expect(n.images).toHaveLength(1);
    expect(fs.existsSync(path.join(store.imagesDir, n.images[0]))).toBe(true);
    expect(store.state.graph.placements['pc-kinetik-vtt-p1']).toBeUndefined(); // lives in the party strip, not on the canvas
    expect(store.history.at(-1)!.actor).toBe('system');
  });

  it('re-syncs when a player changes their character, keeping everything the GM wrote', async () => {
    const c = await connect([jin(), mia()]);
    await until(() => pcs().length === 2);
    const id = 'pc-kinetik-vtt-p1';
    run('update_node', { id, summary: 'Secretly owes the Guild.', body: 'Hook: debt to Orla.', tags: ['hook'] });
    run('set_party_group', { nodeIds: [id], group: 'Rogues' });
    const before = store.history.length;
    c.setParty([jin({ wk: 9, tags: ['Narbe', 'Müde'] }), mia()]); // Sam levelled up
    await until(() => (store.state.nodes[id].fields.sheet as any).wk === 9);
    expect((store.state.nodes[id].fields.sheet as any).tags).toEqual(['Narbe', 'Müde']);
    expect(store.state.nodes[id]).toMatchObject({ summary: 'Secretly owes the Guild.', body: 'Hook: debt to Orla.', tags: ['hook'] }); // the GM's own text survives
    expect(store.state.nodes[id].fields.group).toBe('Rogues');
    expect(store.history.length).toBe(before + 1); // only Jin changed
    // an identical report changes nothing and creates no history
    c.setParty([jin({ wk: 9, tags: ['Narbe', 'Müde'] }), mia()]);
    await new Promise((r) => setTimeout(r, 120));
    expect(store.history.length).toBe(before + 1);
  });

  it('stays available out of session; a player who left the VTT is kept, marked absent; a trashed one is not resurrected', async () => {
    const c = await connect([jin(), mia()]);
    await until(() => pcs().length === 2);
    c.close();
    await until(() => !store.vtt.status().connected);
    // offline: the party is still there for the GM and the AI
    expect(run('get_party').map((p: any) => p.name).sort()).toEqual(['Jin Yamada', 'Mia Cho']);
    expect(run('get_party').find((p: any) => p.name === 'Jin Yamada')).toMatchObject({ player: 'Sam', sheet: { concept: 'Ex-courier turned fixer' } });
    const block = knowledgeBlock(store);
    expect(block).toContain('Jin Yamada (player Sam)');
    expect(block).toContain('Concept: Ex-courier turned fixer'); // labelled with the VTT's own field names (from the cached profile)
    // reconnect with only Jin (Mia left), and the GM had trashed nobody yet
    const c2 = await connect([jin()]);
    await until(() => store.state.nodes['pc-kinetik-vtt-p2'].fields.present === false);
    expect(store.state.nodes['pc-kinetik-vtt-p2'].trashed).toBe(false);
    expect(run('get_party').find((p: any) => p.name === 'Mia Cho')).toMatchObject({ inVtt: false });
    // the GM trashes Mia; she is reported again: she stays gone
    run('delete_node', { id: 'pc-kinetik-vtt-p2' });
    c2.setParty([jin(), mia()]);
    await new Promise((r) => setTimeout(r, 120));
    expect(store.state.nodes['pc-kinetik-vtt-p2'].trashed).toBe(true);
  });

  it('sync_party fetches on demand; the AI can split the party into groups', async () => {
    await connect([jin(), mia()]);
    await until(() => pcs().length === 2);
    expect(await run('sync_party')).toEqual({ characters: ['Jin Yamada', 'Mia Cho'] });
    expect(run('set_party_group', { nodeIds: ['pc-kinetik-vtt-p1'], group: 'Rogues' })).toEqual({ group: 'Rogues', moved: 1 });
    expect(run('set_party_group', { nodeIds: ['pc-kinetik-vtt-p1'], group: '' })).toEqual({ group: null, moved: 1 });
    expect(store.state.nodes['pc-kinetik-vtt-p1'].fields.group).toBeUndefined();
    const npc = run('create_node', { type: 'npc', title: 'Brenn' }).id;
    expect(() => run('set_party_group', { nodeIds: [npc], group: 'x' })).toThrow(/not a player character/);
  });

  it('pc nodes do not trigger pool or mention warnings', async () => {
    await connect([jin(), mia()]);
    await until(() => pcs().length === 2);
    run('create_node', { type: 'scene', title: 'Docks', summary: 'Jin Yamada waits at the docks.', place: 'canvas' });
    const { lintStory } = await import('@pnp/shared');
    const codes = lintStory(store.state).map((i) => `${i.code}:${i.nodeId ?? ''}`);
    expect(codes.some((c) => c.includes('pc-kinetik'))).toBe(false);
    expect(codes.some((c) => c.startsWith('unlinked-mention'))).toBe(false);
  });
});
