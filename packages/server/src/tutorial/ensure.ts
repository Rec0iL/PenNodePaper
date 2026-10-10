import fs from 'node:fs';
import path from 'node:path';
import { bridgePrompt, visitsOf } from '@pnp/shared';
import { runCommand } from '../commands.js';
import { Persistence } from '../persistence.js';
import type { Store } from '../store.js';
import { ACT2_CANVAS, PARTY, SEED_EDGES, SEED_NODES } from './content.js';
import { MAP_ASSETS, installPicture } from './assets.js';
import { beatsFor } from './script.js';

// ---------------------------------------------------------------------------
// The tour builds on what happened before it (the node the AI made, the nodes the players visited). Whoever jumps ahead,
// deletes a node or does things in another order must not break it: before a step needs something, the tour asks for
// it here, and whatever is missing is put back — quietly, as an ordinary command, and only if it is missing.
// ---------------------------------------------------------------------------

const live = (store: Store, id: string) => !!store.state.nodes[id] && !store.state.nodes[id].trashed;
const run = (store: Store, name: string, args: Record<string, unknown>) => runCommand(store, name, args, 'system');
const placed = (store: Store, id: string) => !!store.state.graph.placements[id];

/** The story the practice campaign starts with: every seed node exists, the first five stand on the canvas, their connections are drawn. */
function base(store: Store) {
  for (const n of SEED_NODES) {
    const cur = store.state.nodes[n.id];
    if (cur?.trashed) run(store, 'restore_node', { id: n.id });
    else if (!cur) {
      run(store, 'create_node', { ...n, ...(n.at ? { place: 'canvas', x: n.at.x, y: n.at.y } : {}) });
    }
  }
  for (const e of SEED_EDGES) {
    if (!store.state.graph.edges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind)) run(store, 'link', e);
  }
  for (const n of SEED_NODES.filter((x) => x.at && x.id !== 'harbour-master')) if (live(store, n.id) && !placed(store, n.id)) run(store, 'place_on_canvas', { id: n.id, x: n.at!.x, y: n.at!.y });
}

/** The tavern stands on the canvas, reached from the arrival. */
function anchor(store: Store) {
  base(store);
  if (!placed(store, 'rusty-anchor')) run(store, 'place_on_canvas', { id: 'rusty-anchor', nearNodeId: 'arrival' });
  if (!store.state.graph.edges.some((e) => e.from === 'arrival' && e.to === 'rusty-anchor')) run(store, 'link', { from: 'arrival', to: 'rusty-anchor', kind: 'conditional', label: 'if they want a drink' });
}

/** The tavern stands on the canvas, not yet connected (the tour is about to draw the line). */
function anchorFree(store: Store) {
  base(store);
  if (!placed(store, 'rusty-anchor')) run(store, 'place_on_canvas', { id: 'rusty-anchor', nearNodeId: 'arrival' });
}

/** The tavern is on the canvas and connected from the arrival, but the line has no label and the default kind (the tour is about to label it). */
function anchorLink(store: Store) {
  anchorFree(store);
  if (!store.state.graph.edges.some((e) => e.from === 'arrival' && e.to === 'rusty-anchor')) run(store, 'link', { from: 'arrival', to: 'rusty-anchor', kind: 'leads-to' });
}

/** What the scripted AI builds for the Rusty Anchor (Brenn and his rumour), without the chat around it. */
function brenn(store: Store) {
  anchor(store);
  for (const b of beatsFor('brenn', { store, text: '' })) {
    if (!('tool' in b) || b.tool === 'get_graph' || (b.when && !b.when())) continue;
    run(store, b.tool, typeof b.args === 'function' ? b.args() : b.args);
  }
}

/** The players are in the tavern, having skipped the ledger (so the Story tab has a path, something bypassed and clues they do not know). */
function played(store: Store) {
  anchor(store);
  if (!visitsOf(store.state.nodes.arrival).length) run(store, 'move_players', { characters: PARTY, nodeId: 'arrival' });
  if (!visitsOf(store.state.nodes['rusty-anchor']).some((v) => v.here)) run(store, 'move_players', { characters: PARTY, nodeId: 'rusty-anchor' });
}

/** The scripted AI's bridge (what "Bridge back" builds), without the chat around it. */
function bridge(store: Store) {
  played(store);
  for (const b of beatsFor('bridge', { store, text: bridgePrompt('Keep it short and let a person give the lead.') })) {
    if (!('tool' in b) || b.tool === 'story_status' || (b.when && !b.when())) continue;
    run(store, b.tool, typeof b.args === 'function' ? b.args() : b.args);
  }
}

function frame(store: Store) {
  base(store);
  if (!store.state.graph.frames.length) run(store, 'create_frame', { title: 'Act I · Greywater', nodeIds: ['arrival', 'missing-ledger', 'smugglers-cove', 'cult-reveal'] });
}

/** The second canvas, with one node on it to connect to. */
function act2(store: Store) {
  base(store);
  if (store.state.graph.canvases.length < 2) run(store, 'create_canvas', { name: ACT2_CANVAS.name, id: ACT2_CANVAS.id });
  const other = store.state.graph.canvases.find((c) => c.id !== 'main')!;
  if (!Object.values(store.state.graph.placements).some((p) => p.canvas === other.id)) {
    run(store, 'create_node', { id: 'act2-start', type: 'scene', title: 'Beneath the bell tower', summary: 'The flood chambers are open and the harbour is drowning.', place: 'canvas', canvas: other.id, x: 0, y: 0 });
  }
}

/** The random table and the clock on the canvas, under the story row. */
function tools(store: Store) {
  base(store);
  if (!placed(store, 'harbour-rumours')) run(store, 'place_on_canvas', { id: 'harbour-rumours', canvas: 'main', x: 360, y: 300 });
  if (!placed(store, 'bell-clock')) run(store, 'place_on_canvas', { id: 'bell-clock', canvas: 'main', x: 720, y: 300 });
}

const TAVERN = 'the-rusty-anchor';
/** Step 1 of the two-step painting has been done: two terrains to choose from. */
function mapsTerrain(store: Store) {
  anchor(store);
  const m = store.maps.get(TAVERN);
  const a = MAP_ASSETS[TAVERN];
  if (m.terrains?.length) return;
  const files = (a.terrains ?? []).filter((f) => installPicture(store.imagesDir, f));
  if (!files.length) return;
  m.terrains = files;
  store.maps.save(m, { backup: 'none' });
  store.emitMap(m, 'system');
}

/** …and the props painted on the chosen one (the first when none is chosen). */
function mapsProps(store: Store) {
  mapsTerrain(store);
  const m = store.maps.get(TAVERN);
  const a = MAP_ASSETS[TAVERN];
  if (!m.terrains?.length || m.renders.length) return;
  if (!m.terrainPick) m.terrainPick = m.terrains[0];
  const i = Math.max(0, (a.terrains ?? []).indexOf(m.terrainPick));
  const final = a.finals?.[i];
  if (!final || !installPicture(store.imagesDir, final)) return;
  m.renders = [final];
  store.maps.save(m, { backup: 'none' });
  const n = store.state.nodes['rusty-anchor'];
  store.transact('system', 'Painted map', (tx) => tx.putNode({ ...n, images: [final, ...n.images.filter((f) => f !== final)], updatedAt: new Date().toISOString() }));
  store.emitMap(m, 'system');
}

const RECIPES: Record<string, (s: Store) => void> = { base, anchor, 'anchor-free': anchorFree, 'anchor-link': anchorLink, brenn, played, bridge, frame, act2, tools, 'maps-terrain': mapsTerrain, 'maps-props': mapsProps };

export const RECIPE_NAMES = Object.keys(RECIPES);

/** Put back what the named steps need. Returns what it did. */
export function ensureTutorial(store: Store, need: string[]): string[] {
  const done: string[] = [];
  for (const k of need) {
    const f = RECIPES[k];
    if (!f) continue;
    const before = store.history.length;
    f(store);
    if (store.history.length !== before) done.push(k);
  }
  return done;
}

// ---- the practice campaign's folder ---------------------------------------------------------------------------------

/** The folder of a new practice campaign: `welcome-tour`, or the next free `welcome-tour-N`. Its settings say it is one. */
export function createTutorialCampaign(campaignsDir: string, opts: { reuse?: string; language?: string } = {}): string {
  let dir = opts.reuse ?? path.join(campaignsDir, 'welcome-tour');
  if (!opts.reuse) for (let i = 2; fs.existsSync(dir); i++) dir = path.join(campaignsDir, `welcome-tour-${i}`);
  const language = opts.language ?? 'en';
  new Persistence(dir).writeMeta({ name: 'Greywater (practice campaign)', language, createdAt: new Date().toISOString(), tutorial: { on: true } });
  return dir;
}
