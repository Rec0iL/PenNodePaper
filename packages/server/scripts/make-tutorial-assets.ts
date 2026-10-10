// Makes the pictures the welcome tour plays back (needs a running ComfyUI with Krea 2):
//
//   npx tsx scripts/make-tutorial-assets.ts pictures        # portraits, scenes, handout, item
//   npx tsx scripts/make-tutorial-assets.ts coast           # the region map, painted in one pass
//   npx tsx scripts/make-tutorial-assets.ts tavern=quick    # the tavern map painted in ONE step
//   npx tsx scripts/make-tutorial-assets.ts tavern=a,b      # the tavern map painted in TWO steps (two terrains, each with its props)
//
// It uses the app's own pipelines (the same code that paints maps for you), in a scratch campaign, and writes compact
// JPEGs into assets/tutorial/. Set SEED=<n> to roll again, OUT=<dir> to look at the results before keeping them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupProps, type MapDoc } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { ImageService } from '../src/images.js';
import { Persistence } from '../src/persistence.js';
import { seedDemo } from '../src/seed.js';
import { Store } from '../src/store.js';
import { ASSET_DIR, MAP_ASSETS, PICTURES, TAVERN_MAP, COAST_MAP } from '../src/tutorial/assets.js';

const OUT = process.env.OUT ?? ASSET_DIR;
const SEED = Number(process.env.SEED ?? 11);
const what = process.argv.slice(2);
if (!what.length) {
  console.log('usage: make-tutorial-assets.ts pictures | coast | tavern=quick | tavern=a,b');
  process.exit(1);
}

// What the AI would write for the precise way (kept here, so the pictures can be made again without any AI)
const SHELL =
  'Bare stone-walled building shell with three separate rooms, nothing inside: a large room with worn wooden plank floor, a smaller room with grey flagstone floor, a smaller room with plank floor. Warm lantern light on the walls, thick dark stone walls, wooden doors.';
const PLACE = 'The Rusty Anchor, a rough medieval harbour tavern: a big taproom with worn planks, a stone-floored kitchen and a plank-floored store room. Warm lantern light, salt-stained dark wood, thick stone walls.';
const PROPS: Record<string, string> = {
  table1x6: 'One long narrow vertical plank table running top to bottom, thick dark salt-stained oak boards with iron nails, worn edges, a few tankards and scratches, centered on the wooden floor.',
  tableRow: 'A rectangular wooden tavern table, thick dark plank top with visible grain, ring stains from mugs, a couple of nicks, long side horizontal, standing on the worn plank floor.',
  crates2: 'Two separate wooden shipping crates stacked side by side in a vertical pair, square slatted lids with nailed cross-battens, weathered rope handles, each clearly distinct, on the plank floor.',
  barrels5: 'A row of exactly five separate wooden barrels standing side by side, each a round lid with dark iron hoops and stave lines, clearly distinct, evenly spaced, slightly weathered oak.',
  barrels3: 'A tight cluster of exactly three separate wooden barrels in a 2x2 arrangement, round lids with rusty iron hoops, clearly distinct, pushed against the east wall on the planks.',
  fireplace: 'A wide stone hearth fireplace against the north wall, rough grey masonry surround, ash-filled firebox with glowing orange embers and a few logs, soot-stained flagstone apron.',
  chairsTop: 'A row of exactly three separate wooden chairs side by side, each a square plank seat with a backrest bar along its top edge, clearly distinct, evenly spaced, dark worn wood.',
  chairsBottom: 'A row of exactly three separate wooden chairs side by side, each a square plank seat with a backrest bar along its bottom edge, clearly distinct, evenly spaced, dark worn wood.',
  kitchenTable: 'A sturdy kitchen work table with a scarred pale wooden top, chopping marks, a cutting board and a few scattered onions, long side horizontal, on grey flagstones.',
  stairs: 'A short wooden staircase descending south, seen from above as parallel dark plank steps with side stringers, a dark opening at the bottom edge, worn treads set into the plank floor.',
  barrel: 'A single wooden barrel seen from above, round lid of dark oak staves with two rusty iron hoops and a bung hole, standing on the plank floor.',
  cauldron: 'A round black iron cauldron seen from above, thick rim, dark bubbling stew inside with faint steam, small side handles, resting on grey flagstones.',
  crate: 'A single square wooden crate seen from above, slatted lid with nailed cross-battens, weathered boards, rope handle notches, tucked against the east wall on stone floor.',
  chest: 'A small wooden treasure chest seen from above, rounded dark plank lid with iron straps, brass lock plate and corner rivets, resting on the plank floor.',
};
function propPrompt(kind: string, count: number, extent: string, i: number): string {
  if (kind === 'table') return extent === '1x6' ? PROPS.table1x6 : extent === '2x1' ? PROPS.kitchenTable : PROPS.tableRow;
  if (kind === 'crate') return count > 1 ? PROPS.crates2 : PROPS.crate;
  if (kind === 'barrel') return count >= 5 ? PROPS.barrels5 : count > 1 ? PROPS.barrels3 : PROPS.barrel;
  if (kind === 'chair') return i % 2 ? PROPS.chairsBottom : PROPS.chairsTop;
  if (kind === 'fireplace') return PROPS.fireplace;
  if (kind === 'stairs_down') return PROPS.stairs;
  if (kind === 'cauldron') return PROPS.cauldron;
  return PROPS.chest;
}

// A scratch campaign with the real pipelines: no AI is called, nothing outside this folder is touched
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-assets-'));
const store = new Store(new Persistence(dir));
seedDemo(store);
store.state.meta.tutorial = { on: false };
let mode: 'quick' | 'staged' = 'quick';
const ai = async (_b: unknown, prompt: string) => {
  if (prompt.startsWith('You prepare the FIRST')) return SHELL;
  return '{}'; // props: the prompts are given with the call
};
const images = new ImageService(store, store.imagesDir, (j) => process.stdout.write(`\r  ${j.status} ${Math.round(j.progress * 100)}% ${j.phase ?? ''}                    `), undefined, { mapMode: () => mode, ai });
store.images = images;
const run = (name: string, args: Record<string, unknown>) => runCommand(store, name, args, 'user');

async function idle() {
  await new Promise((r) => setTimeout(r, 1500));
  while (images.jobs.some((j) => j.status === 'queued' || j.status === 'running')) await new Promise((r) => setTimeout(r, 1000));
  const bad = images.jobs.find((j) => j.status === 'error');
  if (bad) throw new Error(bad.error);
  process.stdout.write('\n');
}

/** PNG/anything -> a compact JPEG in the assets folder */
function keep(from: string, name: string, width = 0) {
  fs.mkdirSync(OUT, { recursive: true });
  const args = [from, '-strip', '-quality', '86', '-sampling-factor', '4:2:0', ...(width ? ['-resize', `${width}x>`] : []), path.join(OUT, name)];
  execFileSync('magick', args);
  console.log(`  -> ${name} (${Math.round(fs.statSync(path.join(OUT, name)).size / 1024)} KB)`);
}
const fileOf = (nodeId: string) => store.state.nodes[nodeId].images.at(-1)!;

for (const w of what) {
  if (w === 'pictures') {
    for (const p of PICTURES) {
      if (!store.state.nodes[p.nodeId!]) run('create_node', { id: p.nodeId, type: p.kind === 'item' ? 'item' : 'npc', title: p.nodeId });
      console.log(`${p.file}: ${p.prompt.slice(0, 70)}…`);
      run('generate_image', { nodeId: p.nodeId, prompt: p.prompt, kind: p.kind, seed: SEED });
      await idle();
      keep(path.join(store.imagesDir, fileOf(p.nodeId!)), p.file, p.kind === 'handout' ? 900 : 1100);
    }
  } else if (w === 'coast') {
    console.log('region map: the coast');
    run('render_map', { mapId: COAST_MAP, prompt: 'A hand-painted fantasy coastal region map: a dark grey-green sea, a rocky foggy coast, forests, hills, a winding road and river, small painted towns and a ruined lighthouse.', fidelity: 'balanced', seed: SEED });
    await idle();
    keep(path.join(store.imagesDir, store.maps.get(COAST_MAP).renders.at(-1)!), MAP_ASSETS[COAST_MAP].quick);
  } else if (w.startsWith('tavern=')) {
    const parts = w.slice(7).split(',');
    const m = store.maps.get(TAVERN_MAP) as MapDoc;
    if (parts.includes('quick')) {
      console.log('tavern, ONE step');
      mode = 'quick';
      run('render_map', { mapId: TAVERN_MAP, prompt: PLACE, fidelity: 'balanced', seed: 7 });
      await idle();
      keep(path.join(store.imagesDir, store.maps.get(TAVERN_MAP).renders.at(-1)!), MAP_ASSETS[TAVERN_MAP].quick);
      const cur = store.maps.get(TAVERN_MAP);
      cur.renders = [];
      store.maps.save(cur, { backup: 'none' });
    }
    // the groups, in the order the pipeline paints them, each with its prompt
    const groups = groupProps(m);
    const infos = groups.map((g, i) => propPrompt(g.kind, g.props.length, `${Math.round(g.bbox.x1 - g.bbox.x0)}x${Math.round(g.bbox.y1 - g.bbox.y0)}`, i));
    const prompts = Object.fromEntries(groups.map((g, i) => [g.id, infos[i]]));
    for (const [i, which] of (['a', 'b'] as const).entries()) {
      if (!parts.includes(which)) continue;
      console.log(`tavern, TWO steps, terrain ${which.toUpperCase()}`);
      mode = 'staged';
      run('render_map', { mapId: TAVERN_MAP, prompt: PLACE, fidelity: 'balanced', seed: i === 0 ? 7 : 29 });
      await idle();
      const terrain = store.maps.get(TAVERN_MAP).terrains!.at(-1)!;
      keep(path.join(store.imagesDir, terrain), MAP_ASSETS[TAVERN_MAP].terrains![i]);
      run('set_map_terrain', { mapId: TAVERN_MAP, file: terrain });
      console.log(`  ${groups.length} prop groups…`);
      run('paint_map_props', { mapId: TAVERN_MAP, prompt: PLACE, prompts, seed: i === 0 ? 100 : 200 });
      await idle();
      keep(path.join(store.imagesDir, store.maps.get(TAVERN_MAP).renders.at(-1)!), MAP_ASSETS[TAVERN_MAP].finals![i]);
    }
  } else throw new Error(`unknown: ${w}`);
}
console.log(`done — scratch campaign in ${dir}`);
process.exit(0);
