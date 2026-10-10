import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TOUR_MESSAGES, bridgePrompt, guidanceOf, lintStory, pickDemoScript, tableEntries, visitsOf, type ChatMsg } from '@pnp/shared';
import { Chat } from '../src/chat.js';
import { runCommand } from '../src/commands.js';
import { ImageService } from '../src/images.js';
import { Persistence } from '../src/persistence.js';
import { seedDemo } from '../src/seed.js';
import { Store } from '../src/store.js';
import { ASSET_DIR, MAP_ASSETS, PICTURES, TAVERN_MAP, hasAsset } from '../src/tutorial/assets.js';
import { RECIPE_NAMES, createTutorialCampaign, ensureTutorial } from '../src/tutorial/ensure.js';
import { TutorialComfy, tutorialAi } from '../src/tutorial/fake.js';

beforeAll(() => {
  process.env.PNP_TUTORIAL_SPEED = '0'; // no waiting
});

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}, actor: 'user' | 'claude' = 'user') => runCommand(store, name, args, actor) as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-tour-'));
  store = new Store(new Persistence(dir));
  seedDemo(store);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const live = (id: string) => !!store.state.nodes[id] && !store.state.nodes[id].trashed;

describe('the practice campaign', () => {
  it('is flagged as one and starts with a story, a pool, two maps, a table, a clock and a lore book', () => {
    expect(store.state.meta.tutorial).toEqual({ on: true });
    expect(store.state.meta.language).toBe('en');
    for (const id of ['arrival', 'harbour-master', 'missing-ledger', 'smugglers-cove', 'cult-reveal']) expect(store.state.graph.placements[id]).toBeTruthy();
    for (const id of ['rusty-anchor', 'tavern-brawl', 'old-fisherman', 'dockside-hand', 'harbour-rumours', 'bell-clock', 'greywater-coast']) {
      expect(live(id)).toBe(true);
      expect(store.state.graph.placements[id]).toBeUndefined(); // waiting in the pool
    }
    expect(store.state.graph.edges.length).toBeGreaterThanOrEqual(5);
    expect(tableEntries(store.state.nodes['harbour-rumours']).length).toBeGreaterThanOrEqual(5);
    expect(store.world.list().length).toBe(1);
    expect(store.canUndo).toBe(false); // seeding is not history
  });

  it('gives the tavern a battle map with props and the coast a region map; both are attached to their places', () => {
    const tavern = store.maps.get(TAVERN_MAP);
    expect(tavern.kind).toBe('battle');
    expect(tavern.props.length).toBeGreaterThan(20);
    expect(store.state.nodes['rusty-anchor'].fields.mapId).toBe(TAVERN_MAP);
    const coast = store.maps.get('greywater-coast');
    expect(coast.kind).toBe('region');
    expect(coast.shapes.length).toBeGreaterThan(8);
    expect(store.state.nodes['greywater-coast'].fields.mapId).toBe('greywater-coast');
  });

  it('has no structural problems the Story tab would complain about', () => {
    expect(lintStory(store.state).filter((i) => i.level === 'warn')).toEqual([]);
  });

  it('every picture and map image the tour plays back is shipped', () => {
    for (const p of PICTURES) expect(hasAsset(p.file), p.file).toBe(true);
    for (const m of Object.values(MAP_ASSETS)) for (const f of [m.quick, ...(m.terrains ?? []), ...(m.finals ?? [])]) expect(hasAsset(f), f).toBe(true);
  });

  it('puts the seed pictures on their cards', () => {
    expect(store.state.nodes.arrival.images).toEqual(['arrival.jpg']);
    expect(fs.existsSync(path.join(store.imagesDir, 'arrival.jpg'))).toBe(true);
    expect(store.state.nodes['greywater-coast'].images.length).toBe(1);
  });
});

describe('the scripted AI', () => {
  const messages: ChatMsg[] = [];
  let chat: Chat;
  beforeEach(() => {
    messages.length = 0;
    chat = new Chat({ store, port: 0, token: '', campaignDir: dir, broadcast: (m) => m.t === 'chat' && (messages.push(m.msg), undefined) });
  });
  const ask = (text: string, extra: { nodeId?: string } = {}) => chat.send({ text, backend: 'claude', ...extra });
  const finalMessages = () => [...new Map(messages.map((m) => [m.id, m])).values()];

  it('builds Brenn and his rumour as real, undoable commands, with tool cards in the chat, and labels itself a stand-in', async () => {
    await ask(TOUR_MESSAGES.brenn);
    expect(live('brenn') && live('penny-rumour') && live('black-penny')).toBe(true);
    expect(store.state.graph.placements['rusty-anchor']).toBeTruthy(); // it put the tavern on the canvas first
    expect(store.state.graph.edges.some((e) => e.from === 'brenn' && e.to === 'rusty-anchor' && e.kind === 'belongs-to')).toBe(true);
    expect(store.state.graph.edges.some((e) => e.from === 'penny-rumour' && e.to === 'cult-reveal')).toBe(true);
    const all = finalMessages();
    expect(all.filter((m) => m.role === 'tool').map((m) => m.tool!.name)).toEqual(expect.arrayContaining(['get_graph', 'create_node', 'link', 'update_node']));
    expect(all.filter((m) => m.role === 'tool').every((m) => m.tool!.status === 'ok')).toBe(true);
    expect(all.every((m) => m.role === 'user' || m.demo)).toBe(true);
    expect(all.at(-1)!.text).toContain('💡');
    expect(chat.status.busy).toBe(false);
    // every action is one undo step
    const before = store.history.length;
    expect(before).toBeGreaterThan(3);
    store.undo();
    expect(live('black-penny') || store.state.nodes['rusty-anchor'].body.includes('Brenn knows the cult')).toBe(true);
  });

  it('can be asked twice without making a second Brenn', async () => {
    await ask(TOUR_MESSAGES.brenn);
    const n = Object.keys(store.state.nodes).length;
    await ask(TOUR_MESSAGES.brenn);
    expect(Object.keys(store.state.nodes).length).toBe(n);
  });

  it('is one proposal in review mode', async () => {
    store.state.meta.aiMode = 'review';
    await ask(TOUR_MESSAGES.patrol);
    expect(live('night-patrol')).toBe(true);
    const p = store.proposals();
    expect(p).toHaveLength(1);
    expect(p[0].newNodes).toContain('night-patrol');
    store.rejectProposal(p[0].id);
    expect(live('night-patrol')).toBe(false);
  });

  it('bridges back from where the players are, and follows the GM\'s railguard when there is one', async () => {
    ensureTutorial(store, ['played']);
    store.state.meta.aiMode = 'live';
    const guidance = 'Keep it short and let a person give the lead, no documents.';
    await ask(bridgePrompt(guidance));
    expect(live('bridge-lead')).toBe(true);
    const n = store.state.nodes['bridge-lead'];
    expect(n.body).toContain(guidance);
    expect(n.summary).toMatch(/dockhand/);
    expect(store.state.graph.edges.filter((e) => e.kind === 'bridge').length).toBe(2);
    expect(finalMessages().some((m) => m.role === 'assistant' && m.text.includes(guidance))).toBe(true);
  });

  it('without a railguard the AI chooses (and says so)', async () => {
    ensureTutorial(store, ['played']);
    await ask(bridgePrompt());
    expect(store.state.nodes['bridge-lead'].body).not.toContain('Railguard');
    expect(finalMessages().some((m) => m.text.includes('no railguard'))).toBe(true);
  });

  it('fills a random table, writes a recap and an image prompt for the node it is asked about', async () => {
    const before = tableEntries(store.state.nodes['harbour-rumours']).length;
    await ask('Fill the random table “Harbour rumours” (node harbour-rumours) with fitting entries.', { nodeId: 'harbour-rumours' });
    expect(tableEntries(store.state.nodes['harbour-rumours']).length).toBeGreaterThan(before);

    ensureTutorial(store, ['played']);
    await ask('Write a short, vivid recap of the story so far for my players, in the campaign language.');
    expect(store.state.nodes['recap-previously'].readAloud).toContain('Previously');

    await ask('Write a vivid image prompt for this node (read it with get_node and check get_image_style), then call generate_image for it with kind "portrait" and 1 variant.', { nodeId: 'old-fisherman' });
    expect(images.jobs.some((j) => j.nodeId === 'old-fisherman')).toBe(true);
  });

  it('answers what it was not written for, kindly', async () => {
    await ask('Write me a sonnet');
    expect(finalMessages().at(-1)!.text).toMatch(/stand-in/);
  });
});

let images: ImageService;
beforeEach(() => {
  images = new ImageService(store, store.imagesDir, () => {}, new TutorialComfy(() => ({} as never), () => store.state.meta.tutorial?.on === true), { mapMode: () => 'staged', ai: tutorialAi });
  store.images = images;
});
const idle = async () => {
  while (images.jobs.some((j) => j.status === 'queued' || j.status === 'running')) await new Promise((r) => setTimeout(r, 5));
};

describe('the stand-in image maker runs the real queue', () => {
  it('"generates" the picture made for that node, attaches it, and keeps the record', async () => {
    run('generate_image', { nodeId: 'old-fisherman', prompt: 'An old fisherman at dawn, weathered.', kind: 'portrait' });
    await idle();
    const job = images.jobs.at(-1)!;
    expect(job.status).toBe('done');
    expect(store.state.nodes['old-fisherman'].images).toHaveLength(1);
    expect(store.state.nodes['old-fisherman'].images[0]).toMatch(/\.jpg$/); // the shipped JPEG keeps its type
    expect(fs.existsSync(path.join(store.imagesDir, store.state.nodes['old-fisherman'].images[0]))).toBe(true);
    expect(PICTURES.find((p) => p.nodeId === 'old-fisherman')!.file).toBeTruthy();
    // the stand-in's pace must not pass for this computer's speed (the map panel's estimate)
    expect(images.estimateSeconds(1).measured).toBe(false);
  });

  it('paints a map in two steps: two terrains to choose from, then the props on the chosen one', async () => {
    run('render_map', { mapId: TAVERN_MAP, prompt: 'The Rusty Anchor, a rough harbour tavern.', variants: 2 });
    await idle();
    const m1 = store.maps.get(TAVERN_MAP);
    expect(m1.terrains).toHaveLength(2);
    expect(m1.renders).toHaveLength(0); // nothing is "finished" before the props are painted
    run('set_map_terrain', { mapId: TAVERN_MAP, file: m1.terrains![1] });
    run('paint_map_props', { mapId: TAVERN_MAP, prompt: 'The Rusty Anchor, a rough harbour tavern.' });
    await idle();
    const m2 = store.maps.get(TAVERN_MAP);
    expect(m2.renders).toHaveLength(1);
    const job = images.jobs.at(-1)!;
    expect(job.status).toBe('done');
    // the picture painted onto terrain B is the one that goes with B
    const bytes = fs.readFileSync(path.join(store.imagesDir, m2.renders[0]));
    expect(bytes.equals(fs.readFileSync(path.join(ASSET_DIR, MAP_ASSETS[TAVERN_MAP].finals![1])))).toBe(true);
    expect(store.state.nodes['rusty-anchor'].images).toContain(m2.renders[0]);
  });

  it('and in one step when the map is painted the quick way', async () => {
    const quick = new ImageService(store, store.imagesDir, () => {}, new TutorialComfy(() => ({} as never), () => true), { mapMode: () => 'quick', ai: tutorialAi });
    store.images = quick;
    run('render_map', { mapId: TAVERN_MAP, prompt: 'The Rusty Anchor, a rough harbour tavern.' });
    while (quick.jobs.some((j) => j.status === 'queued' || j.status === 'running')) await new Promise((r) => setTimeout(r, 5));
    const m = store.maps.get(TAVERN_MAP);
    expect(m.renders).toHaveLength(1);
    expect(m.terrains ?? []).toHaveLength(0);
  });

  it('lets a real ComfyUI do the work again once the tour is left', async () => {
    const comfy = new TutorialComfy(() => ({ url: 'http://127.0.0.1:1' } as never), () => false);
    expect(await comfy.alive()).toBe(false); // not reachable: no pretending
  });
});

describe('healing the tour', () => {
  it('puts back a node that was deleted, and what the AI would have built', () => {
    run('delete_node', { id: 'arrival' });
    run('delete_node', { id: 'cult-reveal' });
    const healed = ensureTutorial(store, ['brenn']);
    expect(healed).toContain('brenn');
    for (const id of ['arrival', 'cult-reveal', 'brenn', 'penny-rumour', 'black-penny']) expect(live(id)).toBe(true);
    expect(store.state.graph.placements.arrival).toBeTruthy();
    expect(ensureTutorial(store, ['brenn'])).toEqual([]); // nothing missing: nothing done
  });

  it('prepares the players\' path for the Story chapter', () => {
    ensureTutorial(store, ['played']);
    expect(visitsOf(store.state.nodes.arrival).length).toBeGreaterThan(0);
    expect(visitsOf(store.state.nodes['rusty-anchor']).some((v) => v.here)).toBe(true);
  });

  it('puts back a painted map (both steps) for whoever jumps straight to the end of the map chapter', () => {
    ensureTutorial(store, ['maps-props']);
    const m = store.maps.get(TAVERN_MAP);
    expect(m.terrains).toHaveLength(2);
    expect(m.terrainPick).toBe(m.terrains![0]);
    expect(m.renders).toHaveLength(1);
    expect(store.state.nodes['rusty-anchor'].images[0]).toBe(m.renders[0]);
    expect(fs.existsSync(path.join(store.imagesDir, m.renders[0]))).toBe(true);
    expect(ensureTutorial(store, ['maps-props'])).toEqual([]);
  });

  it('adds the second canvas', () => {
    ensureTutorial(store, ['act2']);
    expect(store.state.graph.canvases.map((c) => c.id)).toContain('act-2');
  });

  it('does not touch anything in a campaign that is not a practice campaign', () => {
    store.state.meta.tutorial = undefined;
    expect(createTutorialCampaign(os.tmpdir() + '/__none__', { reuse: path.join(dir, 'x') })).toBe(path.join(dir, 'x'));
  });
});

describe('the tour steps', () => {
  const dir = path.resolve(__dirname, '../../web/src/lib/tour');
  const files = fs.readdirSync(dir).filter((f) => /^steps-.*\.ts$/.test(f));
  const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

  it('only ask the server for recipes it has', () => {
    const asked = [...text.matchAll(/need: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]));
    expect(asked.length).toBeGreaterThan(5);
    for (const a of asked) expect(RECIPE_NAMES, `unknown recipe "${a}"`).toContain(a);
  });

  it('have unique ids and belong to a chapter that is listed', () => {
    const ids = [...text.matchAll(/\bid: '([\w-]+)'/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const list = fs.readFileSync(path.join(dir, 'steps.ts'), 'utf8');
    const chapters = new Set([...list.matchAll(/\{ id: '([\w-]+)', title:/g)].map((m) => m[1]));
    for (const m of text.matchAll(/\bs\('([\w-]+)', \{/g)) expect(chapters, `chapter "${m[1]}"`).toContain(m[1]);
  });

  it('point at nodes that exist in the practice campaign', () => {
    const known = new Set([...Object.keys(store.state.nodes), 'brenn', 'penny-rumour', 'black-penny', 'night-patrol', 'bridge-lead', 'recap-previously', 'act2-start']);
    for (const m of text.matchAll(/card\('([\w-]+)'\)/g)) expect(known, `card("${m[1]}")`).toContain(m[1]);
    for (const m of text.matchAll(/pool\('([\w-]+)'\)/g)) expect(known, `pool("${m[1]}")`).toContain(m[1]);
  });
});

describe('words the app and the tour share', () => {
  it('recognises the requests by their opening words', () => {
    expect(pickDemoScript(TOUR_MESSAGES.brenn)).toBe('brenn');
    expect(pickDemoScript(bridgePrompt())).toBe('bridge');
    expect(pickDemoScript('hello')).toBe('default');
  });
  it('the bridge request carries the railguard only when there is one', () => {
    expect(bridgePrompt()).not.toMatch(/guidance for the bridge/);
    expect(bridgePrompt('  keep it short  ')).toContain('“keep it short”');
    expect(guidanceOf(bridgePrompt('a  b\nc'))).toBe('a b c');
    expect(guidanceOf(bridgePrompt())).toBe('');
  });
});
