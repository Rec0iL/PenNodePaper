import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { BRIDGE_PROTOCOL, soundsOf } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { toPng, renderSvg, newMap } from '../src/maps.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { connectMockVtt, D20_LIKE_PROFILE, ELDARAHQ_PROFILE, HEROHQ_PROFILE, KINETIK_LIKE_PROFILE, STRUCTURE_ONLY_PROFILE } from '../scripts/mock-vtt.js';

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
const png = () => toPng(renderSvg(newMap('x', 'x', 'battle', 6, 6)));

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-vtt-'));
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

const connect = async (profile = KINETIK_LIKE_PROFILE) => {
  const c = connectMockVtt(url, profile);
  clients.push(c);
  await until(() => store.vtt.status().connected);
  return c;
};

describe('VTT bridge', () => {
  it('announces capabilities live, caches the profile, and falls back to it offline', async () => {
    expect(run('get_vtt_capabilities')).toMatchObject({ connected: false, source: 'none' });
    const c = await connect();
    await until(() => c.received.some((m) => m.t === 'welcome'));
    expect(c.received[0]).toMatchObject({ t: 'welcome', protocol: BRIDGE_PROTOCOL, app: 'pennodepaper' });
    expect(run('get_vtt_capabilities')).toMatchObject({ connected: true, source: 'live', vtt: { id: 'kinetik-vtt' } });
    expect(fs.existsSync(path.join(dir, 'vtts', 'kinetik-vtt.vtt.json'))).toBe(true);
    c.close();
    await until(() => !store.vtt.status().connected);
    expect(run('get_vtt_capabilities')).toMatchObject({ connected: false, source: 'cached', vtt: { name: 'KINETIK VTT' } });
  });

  it('pushes handouts (image preferred, GM notes never sent), scenes with grid + tokens, and NPCs with the VTT’s tiers', async () => {
    const c = await connect();
    // handout with image + read-aloud, GM-only body
    const h = run('create_node', { type: 'handout', title: 'Torn page', summary: 'Half a page.', readAloud: 'Dates and a crest.', body: 'SECRET GM NOTES' }).id;
    fs.writeFileSync(path.join(store.imagesDir, 'torn.png'), png());
    store.transact('user', 'img', (tx) => tx.putNode({ ...tx.requireNode(h), images: ['torn.png'] }));
    expect(await run('push_handout', { nodeId: h })).toMatchObject({ pushed: 'handout', as: 'image' });
    const hp = c.received.find((m) => m.t === 'push' && m.kind === 'handout') as any;
    expect(hp.payload.image.mime).toBe('image/png');
    expect(JSON.stringify(hp)).not.toContain('SECRET GM NOTES');
    // text-only handout; and a node with nothing to hand out is rejected
    const t = run('create_node', { type: 'handout', title: 'Letter', readAloud: 'Dear friend…' }).id;
    expect(await run('push_handout', { nodeId: t })).toMatchObject({ as: 'text' });
    const empty = run('create_node', { type: 'handout', title: 'Blank' }).id;
    await expect(run('push_handout', { nodeId: empty })).rejects.toThrow(/nothing|no read-aloud/i);

    // scene from a map: grid size = render cell size, tokens in cell coords
    const { mapId, nodeId } = run('create_map', { name: 'Cellar', cols: 12, rows: 10 });
    run('edit_map', { mapId, ops: [{ op: 'room', x: 1, y: 1, w: 6, h: 5 }, { op: 'token', x: 2, y: 2, kind: 'pc', label: 'P1' }, { op: 'token', x: 4, y: 2, kind: 'npc', label: 'N1' }, { op: 'token', x: 5, y: 3, kind: 'enemy', label: 'E1' }] });
    await expect(run('push_scene', { mapId, image: 'painted' })).rejects.toThrow(/render_map first/);
    const r = await run('push_scene', { mapId, image: 'plan', activate: true });
    expect(r).toMatchObject({ pushed: 'scene', tokens: 2 }); // players are added in the VTT itself: the pc start marker is not sent by default
    const sp = c.received.find((m) => m.t === 'push' && m.kind === 'scene') as any;
    expect(sp.payload).toMatchObject({ id: mapId, grid: { type: 'square', size: 112, unitsPerCell: 6, unit: 'ft' }, activate: true, tokens: [{ x: 4, y: 2, kind: 'npc', label: 'N1' }, { x: 5, y: 3, kind: 'enemy', label: 'E1' }] });
    expect(nodeId).toBeTruthy();

    // ...unless asked for (testing), or the VTT's profile says it wants them
    expect(await run('push_scene', { mapId, image: 'plan', includePlayers: true })).toMatchObject({ tokens: 3 });
    const wants = await connect({ ...KINETIK_LIKE_PROFILE, push: { ...KINETIK_LIKE_PROFILE.push, scene: { grids: ['square'], tokens: true, playerStarts: true } } });
    await until(() => store.vtt.status().profile?.push.scene?.playerStarts === true);
    expect(await run('push_scene', { mapId, image: 'plan' })).toMatchObject({ tokens: 3 });
    expect(await run('push_scene', { mapId, image: 'plan', includePlayers: false })).toMatchObject({ tokens: 2 }); // explicit choice wins
    expect(wants).toBeTruthy();
  });

  it('enemies: the sheet form is the VTT’s own schema; presets, validation and push all follow it', async () => {
    const c = await connect();
    const n = run('create_node', { type: 'enemy', title: 'Dockside Brute', summary: 'Hired muscle.', body: 'Weak to flattery.' }).id;
    // role defaults from the node type; a preset starts from the game's own defaults
    const r = run('set_character_sheet', { nodeId: n, preset: 'schlaeger', sheet: { tags: ['Am Boden'], moves: [{ name: 'Shove', text: 'Pushes someone back.' }, 'Bark'] } });
    expect(r).toMatchObject({ role: 'enemy', preset: 'schlaeger', sheet: { tier: 'schlaeger', level: 2, bonus: 2, wk: 4, tags: ['Am Boden'] } });
    expect(r.sheet.moves).toEqual([{ name: 'Shove', text: 'Pushes someone back.' }, { name: 'Bark' }]); // string shorthand fills the first item field
    expect(r.sheet.count).toBeUndefined(); // showIf: group size only exists for goons
    // validation: bad enum / out of range are rejected with the reason; usual-range deviations only warn
    expect(() => run('set_character_sheet', { nodeId: n, sheet: { tier: 'dragon' } })).toThrow(/not one of: goon, schlaeger/);
    expect(() => run('set_character_sheet', { nodeId: n, sheet: { level: 99 } })).toThrow(/above the maximum 10/);
    expect(run('set_character_sheet', { nodeId: n, sheet: { level: 5 } }).warnings.join()).toMatch(/outside the usual range 1–2 for "Schläger"/);
    expect(() => run('set_character_sheet', { nodeId: n, preset: 'dragonling' })).toThrow(/Unknown preset/);
    // push: portrait is a small square crop, only schema keys travel, GM notes go to `notes`
    fs.writeFileSync(path.join(store.imagesDir, 'brute.png'), png());
    store.transact('user', 'img', (tx) => tx.putNode({ ...tx.requireNode(n), images: ['brute.png'] }));
    expect(await run('push_character', { nodeId: n })).toMatchObject({ pushed: 'character', role: 'enemy', portrait: true });
    const cp = c.received.find((m) => m.t === 'push' && m.kind === 'character') as any;
    expect(cp.payload).toMatchObject({ id: n, role: 'enemy', name: 'Dockside Brute', preset: 'schlaeger', sheet: { tier: 'schlaeger', wk: 4 } });
    expect(cp.payload.notes).toContain('Weak to flattery');
    expect(cp.payload.portrait.mime).toBe('image/png');
    expect(Object.keys(cp.payload.sheet).sort()).toEqual(['bonus', 'energie', 'level', 'moves', 'schutz', 'tags', 'tier', 'wk']);
    // a neutral NPC uses the other role with its own fields
    const npc = run('create_node', { type: 'npc', title: 'Brenn', fields: { sheet: { note: 'Barkeep', size: 1 } } }).id;
    expect(await run('push_character', { nodeId: npc })).toMatchObject({ role: 'npc' });
  });

  it('legacy loose fields on a node are migrated into the sheet on the next edit', async () => {
    await connect();
    const n = run('create_node', { type: 'enemy', title: 'Old', fields: { tier: 'goon', level: 0, count: 4, bogus: 1 } }).id;
    const r = run('set_character_sheet', { nodeId: n, sheet: {} });
    expect(r.sheet).toMatchObject({ tier: 'goon', level: 0, count: 4 });
    expect(r.warnings.join()).toMatch(/ignored.*bogus/);
    expect(store.state.nodes[n].fields).toMatchObject({ role: 'enemy', sheet: { tier: 'goon', count: 4 } });
    expect(store.state.nodes[n].fields.tier).toBeUndefined();
  });

  it('works for a completely different game: the schema decides what a character is', async () => {
    const c = await connect(D20_LIKE_PROFILE);
    const caps = run('get_vtt_capabilities');
    expect(caps.characterRoles.map((r: any) => r.id)).toEqual(['monster']);
    const n = run('create_node', { type: 'enemy', title: 'Gnoll Marauder' }).id; // role falls back to the VTT's first role
    await expect(run('push_character', { nodeId: n })).rejects.toThrow(/doesn't fit the Dungeon Table "Monster" sheet.*cr: required.*hp: required/);
    run('set_character_sheet', { nodeId: n, preset: 'brute', sheet: { cr: '1/2', flying: 'false', attacks: [{ name: 'Spear', toHit: '5', damage: '1d6+3' }] } });
    expect(store.state.nodes[n].fields.sheet).toMatchObject({ cr: '1/2', hp: 45, ac: 13, str: 18, dex: 10, flying: false, attacks: [{ name: 'Spear', toHit: 5, damage: '1d6+3' }] });
    await run('push_character', { nodeId: n });
    const cp = c.received.find((m) => m.t === 'push' && m.kind === 'character') as any;
    expect(cp.payload.role).toBe('monster');
    expect(cp.payload.sheet.attacks[0]).toEqual({ name: 'Spear', toHit: 5, damage: '1d6+3' });
  });

  it('real ruleset: the shipped EldaraHQ profile (NPC list entries with combat fields, party role) works end to end', async () => {
    const c = await connect(ELDARAHQ_PROFILE);
    expect(run('get_vtt_capabilities')).toMatchObject({ canReceiveCharacters: true, characterRoles: [{ id: 'nsc' }, { id: 'pc' }] });
    // enemy and npc nodes both use the nsc role (its `for` hints); hp only exists while a combat side is chosen
    const e = run('create_node', { type: 'enemy', title: 'Kraken-Seemann', summary: 'Zäher Seeräuber.' }).id;
    const r = run('set_character_sheet', { nodeId: e, sheet: { rolle: 'Seeräuber', haltung: 'feindlich', kampfSeite: 'Gegner', hp: 30, tokenGroesse: 1.5 } });
    expect(r.role).toBe('nsc');
    expect(r.sheet).toMatchObject({ kampfSeite: 'gegner', hp: 30, tokenGroesse: 1.5 });
    expect(() => run('set_character_sheet', { nodeId: e, sheet: { kampfSeite: 'Piraten' } })).toThrow(/kampfSeite.*none, gegner, verbuendet/);
    expect(() => run('set_character_sheet', { nodeId: e, sheet: { tokenGroesse: 20 } })).toThrow(/above the maximum 8/);
    expect(run('set_character_sheet', { nodeId: e, sheet: { kampfSeite: 'none' } }).sheet).not.toHaveProperty('hp');
    run('set_character_sheet', { nodeId: e, sheet: { kampfSeite: 'gegner', hp: 30 } });
    await run('push_character', { nodeId: e });
    const cp = c.received.find((m) => m.t === 'push' && m.kind === 'character') as any;
    expect(cp.payload.role).toBe('nsc');
    expect(cp.payload.sheet).toMatchObject({ rolle: 'Seeräuber', kampfSeite: 'gegner', hp: 30 });
    const n = run('create_node', { type: 'npc', title: 'Hafenmeisterin Orla' }).id;
    expect(run('set_character_sheet', { nodeId: n, sheet: { ort: 'Hafen', haltung: 'misstrauisch' } }).role).toBe('nsc');
  });

  it('both shipped How to be a Hero profiles stay well-formed and differ where the apps differ', () => {
    for (const p of [ELDARAHQ_PROFILE, HEROHQ_PROFILE]) {
      expect(p.protocol).toBe(1);
      expect(p.provides?.party).toBe(true);
      expect(p.characters!.roles.map((r) => r.id)).toEqual(['nsc', 'pc']);
      for (const role of p.characters!.roles) {
        const keys = role.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
    // EldaraHQ has a map and a combat tracker, HeroHQ has neither
    expect(ELDARAHQ_PROFILE.push.scene).toMatchObject({ grids: ['square'] });
    expect(HEROHQ_PROFILE.push.scene).toBeUndefined();
    expect(HEROHQ_PROFILE.characters!.roles[0].fields.map((f) => f.key)).not.toContain('hp');
  });

  it('HeroHQ has no map: PenNodePaper refuses a scene push before it reaches the VTT', async () => {
    const c = await connect(HEROHQ_PROFILE);
    const m = run('create_map', { name: 'Schankraum', kind: 'battle' }).mapId;
    await expect(run('push_scene', { mapId: m, image: 'plan' })).rejects.toThrow(/can't receive "scene"/);
    expect(c.received.some((x) => x.t === 'push')).toBe(false);
  });

  it('a VTT that only DESCRIBES characters: the AI can still write sheets for the GM, pushing is refused with guidance', async () => {
    const c = await connect(STRUCTURE_ONLY_PROFILE);
    expect(run('get_vtt_capabilities')).toMatchObject({ canReceiveCharacters: false, characterRoles: [{ id: 'nsc' }, { id: 'pc' }] });
    const e = run('create_node', { type: 'enemy', title: 'Sumpfgeist' }).id;
    run('set_character_sheet', { nodeId: e, sheet: { rolle: 'Spuk', auffaelligkeit: 'Leuchtende Augen' } });
    expect(store.state.nodes[e].fields.sheet).toMatchObject({ rolle: 'Spuk' });
    await expect(run('push_character', { nodeId: e })).rejects.toThrow(/describes characters but can't receive them yet/);
    expect(c.received.some((m) => m.t === 'push')).toBe(false);
    // still exportable
    const x = run('export_vtt_bundle', { format: 'upf', handouts: [], maps: [], characters: [e] });
    expect(x.characters).toBe(1);
    const b = JSON.parse(fs.readFileSync(path.join(store.exportsDir, x.file), 'utf8'));
    expect(b.characters[0]).toMatchObject({ role: 'nsc', name: 'Sumpfgeist', sheet: { rolle: 'Spuk' } });
  });

  it('works offline from the cached profile (structure survives the VTT disconnecting)', async () => {
    const c = await connect(ELDARAHQ_PROFILE);
    c.close();
    await until(() => !store.vtt.status().connected);
    const e = run('create_node', { type: 'enemy', title: 'Offline Ghoul' }).id;
    expect(run('set_character_sheet', { nodeId: e, sheet: { kampfSeite: 'gegner', hp: 12 } }).role).toBe('nsc');
    await expect(run('push_character', { nodeId: e })).rejects.toThrow(/No VTT is connected/);
  });

  it('respects capabilities and reports a missing connection', async () => {
    await expect(run('push_character', { nodeId: run('create_node', { type: 'npc', title: 'X' }).id })).rejects.toThrow(/No VTT profile is known yet/);
    await connect(); // KINETIK-like profile has no music_cue support
    await expect(run('play_track', { action: 'play', mood: 'tense' })).rejects.toThrow(/can't receive "music_cue"/);
    expect(await run('list_vtt_tracks')).toEqual([{ id: 'harbour-night', title: 'Harbour at night', category: 'ambient' }, { id: 'my-upload', title: 'My battle theme', uploaded: true }]);
  });

  it('a VTT speaking another protocol version is refused', async () => {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(url);
    clients.push({ close: () => ws.close() });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', protocol: 99, profile: KINETIK_LIKE_PROFILE })));
    const code = await new Promise<number>((r) => ws.once('close', (c) => r(c)));
    expect(code).toBe(1008);
    expect(store.vtt.status().connected).toBe(false);
  });
});

describe('offline export', () => {
  it('writes a valid KINETIK session file with correctly hashed assets', async () => {
    const h = run('create_node', { type: 'handout', title: 'Poster', readAloud: 'WANTED' }).id;
    fs.writeFileSync(path.join(store.imagesDir, 'poster.png'), png());
    store.transact('user', 'img', (tx) => tx.putNode({ ...tx.requireNode(h), images: ['poster.png'] }));
    const text = run('create_node', { type: 'handout', title: 'Rumour', readAloud: 'They say the bell tolls thirteen.' }).id;
    const { mapId } = run('create_map', { name: 'Hall', cols: 10, rows: 8, unit: 5 });
    run('edit_map', { mapId, ops: [{ op: 'room', x: 1, y: 1, w: 5, h: 4 }, { op: 'token', x: 2, y: 2, kind: 'enemy', label: 'E1' }, { op: 'token', x: 3, y: 2, kind: 'npc', label: 'N1' }, { op: 'token', x: 4, y: 2, kind: 'pc', label: 'P1' }] });

    const r = run('export_vtt_bundle', { format: 'kinetik-session', maps: [mapId], handouts: [h, text] }); // the map below has an enemy token, an npc token and a pc start
    expect(r).toMatchObject({ handouts: 2, scenes: 1 });
    const file = JSON.parse(fs.readFileSync(path.join(store.exportsDir, r.file), 'utf8'));
    expect(file).toMatchObject({ kinetik: 'session', version: 1 });
    const s = file.session;
    expect(s.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // the VTT's room-code alphabet
    expect(s.scenes).toHaveLength(1);
    expect(s.scenes[0]).toMatchObject({ width: 1344, height: 1072, grid: { size: 134, unitsPerCell: 5, unit: 'ft', show: true }, fog: { enabled: false, ops: [] } });
    expect(s.scenes[0].tokens[0]).toMatchObject({ kind: 'npc', x: 335, y: 335, size: 1 }); // centre of cell (2,2) at 134 px per cell
    expect(s.scenes[0].tokens.map((t: any) => t.name)).toEqual(['E1', 'N1']); // pc start marker omitted by default
    expect(s.activeScene).toBe(mapId);
    // every referenced asset exists and its key is sha256(raw bytes)[0..16] — the VTT's hash scheme
    const hashes = [s.scenes[0].asset, ...s.handouts.filter((x: any) => x.hash).map((x: any) => x.hash)];
    for (const hash of hashes) {
      expect(file.assets[hash]).toBeTruthy();
      const raw = Buffer.from(file.assets[hash].b64, 'base64');
      expect(createHash('sha256').update(raw).digest().subarray(0, 16).toString('hex')).toBe(hash);
    }
    expect(s.handouts.map((x: any) => x.kind).sort()).toEqual(['image', 'text']);
    expect(s.handouts.find((x: any) => x.kind === 'text').text).toContain('thirteen');
  });

  it('exports everything that is ready: NPCs as tokens on their place\'s scene, place pictures as grid-less backdrops, enemies with a token portrait', async () => {
    const c = await connect(); // the cached profile is what lets sheets be checked offline
    c.close();
    await until(() => !store.vtt.status().connected);
    const cellar = run('create_node', { type: 'location', title: 'Cellar' }).id;
    const hall = run('create_node', { type: 'location', title: 'Hall' }).id;
    fs.writeFileSync(path.join(store.imagesDir, 'hall.png'), png());
    store.transact('user', 'img', (tx) => tx.putNode({ ...tx.requireNode(hall), images: ['hall.png'] }));
    const { mapId } = run('create_map', { name: 'Cellar map', nodeId: cellar, cols: 10, rows: 8 });
    run('edit_map', { mapId, ops: [{ op: 'room', x: 1, y: 1, w: 6, h: 5 }] });
    const brenn = run('create_node', { type: 'npc', title: 'Brenn', summary: 'Barkeep.' }).id;
    run('set_character_sheet', { nodeId: brenn, sheet: { note: 'Knows the cult\nand pours slowly', size: 2 } });
    run('link', { from: brenn, to: cellar, kind: 'belongs-to' });
    const ghost = run('create_node', { type: 'npc', title: 'Wanderer' }).id;
    run('set_character_sheet', { nodeId: ghost, sheet: { note: 'Passing through' } });
    const brute = run('create_node', { type: 'enemy', title: 'Brute' }).id;
    run('set_character_sheet', { nodeId: brute, preset: 'schlaeger' });
    fs.writeFileSync(path.join(store.imagesDir, 'brute.png'), png());
    store.transact('user', 'img', (tx) => tx.putNode({ ...tx.requireNode(brute), images: ['brute.png'] }));

    const r = run('export_vtt_bundle', { format: 'kinetik-session' });
    expect(r).toMatchObject({ scenes: 2, npcTokens: 2 }); // the cellar map + the hall picture
    const s = JSON.parse(fs.readFileSync(path.join(store.exportsDir, r.file), 'utf8')).session;
    const mapScene = s.scenes.find((x: any) => x.id === mapId);
    const backdrop = s.scenes.find((x: any) => x.id.startsWith(`${hall}:`));
    expect(backdrop).toMatchObject({ name: 'Hall', tokens: [], grid: { show: false } }); // no map of its own: plain name
    expect(mapScene.grid.show).toBe(true);
    const tok = mapScene.tokens.find((t: any) => t.src === `pnp:${brenn}`);
    expect(tok).toMatchObject({ name: 'Brenn', kind: 'npc', size: 2, note: 'Knows the cult and pours slowly', hidden: false });
    expect(tok.x).toBeGreaterThan(0);
    expect(tok.x).toBeLessThan(mapScene.width);
    // an NPC that belongs to no place stands on the first scene
    expect([...s.scenes[0].tokens, ...s.scenes[1].tokens].some((t: any) => t.src === `pnp:${ghost}`)).toBe(true);
    // enemies stay combat NPCs and carry the portrait for token and card
    const e = s.combat.npcs.find((n: any) => n.src === `pnp:${brute}`);
    expect(e).toMatchObject({ type: 'schlaeger' });
    expect(e.img).toMatch(/^data:image\//);
    expect(e.token).toBe(e.img);
    expect(s.combat.npcs).toHaveLength(1);
  });

  it('upf format and the default selection', () => {
    run('create_node', { type: 'handout', title: 'Letter', readAloud: 'Hello' });
    run('create_node', { type: 'handout', title: 'Empty' }); // nothing to hand out: skipped by default
    const r = run('export_vtt_bundle', { format: 'upf' });
    expect(r.handouts).toBe(1);
    const b = JSON.parse(fs.readFileSync(path.join(store.exportsDir, r.file), 'utf8'));
    expect(b).toMatchObject({ upf: 1, app: 'pennodepaper' });
  });
});

describe('drop-in client for vanilla-JS VTTs (docs/pnp-bridge-client.js)', () => {
  it('connects, announces its profile, answers pushes and requests, and reports handler errors', async () => {
    const { connectPnp } = (await import(/* @vite-ignore */ new URL('../../../docs/pnp-bridge-client.js', import.meta.url).href)) as { connectPnp: (o: Record<string, unknown>) => { close(): void } };
    const seen: unknown[] = [];
    const statuses: string[] = [];
    const link = connectPnp({
      url, token: 'ignored-by-the-test-server', profile: { ...STRUCTURE_ONLY_PROFILE, requests: ['tracks'] },
      onPush: async (kind: string, payload: { title?: string }) => {
        if (kind !== 'handout') throw new Error(`I only do handouts, not ${kind}`);
        seen.push(payload.title);
        return { stored: true };
      },
      onRequest: async () => [{ id: 't1', title: 'Track' }],
      onStatus: (s: string) => statuses.push(s),
    });
    clients.push(link);
    await until(() => store.vtt.status().connected);
    await until(() => statuses.includes('connected')); // the hub counts as connected a moment before the client has seen its welcome
    expect(store.vtt.status().profile?.id).toBe('herohq');
    const h = run('create_node', { type: 'handout', title: 'Brief', readAloud: 'Hallo' }).id;
    expect(await run('push_handout', { nodeId: h })).toMatchObject({ pushed: 'handout' });
    expect(seen).toEqual(['Brief']);
    expect(await run('list_vtt_tracks')).toEqual([{ id: 't1', title: 'Track' }]);
    await expect(run('play_track', { action: 'stop' })).rejects.toThrow(/can't receive "music_cue"/); // gated by the profile before it reaches the VTT
    link.close();
    await until(() => !store.vtt.status().connected);
    expect(statuses.at(-1)).toBe('closed');
  });
});

describe('sound cues of a node', () => {
  const pushes = (c: { received: any[] }) => c.received.filter((m) => m.t === 'push');

  it('stores the list on the node (replacing, cleaning, migrating the old loose field) and reads it back', () => {
    const id = run('create_node', { type: 'scene', title: 'The bell', fields: { sound: { trackId: 'bell', titel: 'Gong / Glocke', wann: 'Beim Vorlesen: zwölf Schläge' } } }).id;
    expect(soundsOf(store.state.nodes[id])).toEqual([{ trackId: 'bell', title: 'Gong / Glocke', note: 'Beim Vorlesen: zwölf Schläge' }]); // the old shape still reads
    run('set_node_sounds', { nodeId: id, sounds: [{ trackId: 'bell', note: 'at midnight' }, { trackId: 'bell' }, { trackId: 'boss', title: 'Boss 1' }] });
    const fields = store.state.nodes[id].fields;
    expect(fields.sound).toBeUndefined();
    expect(fields.sounds).toEqual([{ trackId: 'bell', note: 'at midnight' }, { trackId: 'boss', title: 'Boss 1' }]); // duplicate dropped
    run('set_node_sounds', { nodeId: id, sounds: [] });
    expect(store.state.nodes[id].fields.sounds).toBeUndefined();
    store.undo();
    expect(soundsOf(store.state.nodes[id]).map((s) => s.trackId)).toEqual(['bell', 'boss']);
  });

  it('play_node starts the cues in order and, if asked, hands out the node at the same time', async () => {
    const c = await connect(ELDARAHQ_PROFILE);
    const id = run('create_node', { type: 'scene', title: 'The bell tolls', readAloud: 'Twelve strokes ring over the harbour.' }).id;
    run('set_node_sounds', { nodeId: id, sounds: [{ trackId: 'bell', title: 'Gong' }, { trackId: 'music_horror', title: 'Horror' }] });

    const r = await run('play_node', { nodeId: id, handout: true });
    expect(r).toMatchObject({ played: ['Gong', 'Horror'], handout: 'The bell tolls' });
    const p = pushes(c);
    expect(p.filter((m) => m.kind === 'music_cue').map((m) => m.payload)).toEqual([{ action: 'play', trackId: 'bell' }, { action: 'play', trackId: 'music_horror' }]);
    expect(p.find((m) => m.kind === 'handout').payload).toMatchObject({ id: id, kind: 'text', reveal: true, text: 'Twelve strokes ring over the harbour.' });

    c.received.length = 0;
    await run('play_node', { nodeId: id }); // sound only
    expect(pushes(c).map((m) => m.kind)).toEqual(['music_cue', 'music_cue']);
    c.received.length = 0;
    await run('play_node', { nodeId: id, trackId: 'music_horror' }); // one cue
    expect(pushes(c).map((m) => m.payload.trackId)).toEqual(['music_horror']);
  });

  it('says what is wrong instead of failing silently', async () => {
    await connect(ELDARAHQ_PROFILE);
    const bare = run('create_node', { type: 'scene', title: 'Nothing here' }).id;
    await expect(run('play_node', { nodeId: bare })).rejects.toThrow(/no sounds yet/);
    await expect(run('play_node', { nodeId: bare, handout: true })).rejects.toThrow(/nothing to hand out|no read-aloud text/);
    run('set_node_sounds', { nodeId: bare, sounds: [{ trackId: 'bell' }] });
    const partial = await run('play_node', { nodeId: bare, handout: true }); // the sound works, the handout cannot
    expect(partial).toMatchObject({ played: ['bell'], handout: null, problems: [expect.stringMatching(/^handout:/)] });
  });
});
