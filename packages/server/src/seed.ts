import fs from 'node:fs';
import { applyOps, type MapDoc } from '@pnp/shared';
import { runCommand } from './commands.js';
import type { Store } from './store.js';
import { COAST_MAP, MAP_ASSETS, PICTURES, TAVERN_MAP, assetPath, hasAsset, installPicture } from './tutorial/assets.js';
import { CAMPAIGN_NAME, COAST_OPS, SEED_EDGES, SEED_NODES, WORLD_BOOK } from './tutorial/content.js';

/**
 * The first-launch campaign: a small story with a tavern, a handout, a random table and two maps — and the practice
 * ground of the welcome tour. Its AI and its image maker are scripted stand-ins (`meta.tutorial.on`) until the tour is left,
 * so nothing has to be set up to try everything.
 */
export function seedDemo(store: Store) {
  if (Object.keys(store.state.nodes).length) return;
  store.state.meta = { ...store.state.meta, name: CAMPAIGN_NAME, language: 'en', tutorial: { on: true } };
  store.persistence.writeMeta(store.state.meta);
  const run = (name: string, args: unknown) => runCommand(store, name, args, 'system');

  // ---- maps first: the nodes point at them ----
  const maps = store.maps;
  const tavern = JSON.parse(fs.readFileSync(assetPath('rusty-anchor.map.json'), 'utf8')) as MapDoc;
  tavern.updatedAt = new Date().toISOString();
  maps.save(tavern, { backup: 'none' });
  const coast = maps.create('Greywater and the coast', 'region', undefined, undefined, undefined, COAST_MAP);
  coast.size = { w: 1344, h: 768 };
  coast.background = 'sea';
  applyOps(coast, COAST_OPS as never);
  maps.save(coast, { backup: 'none' });

  const imagesDir = store.imagesDir;
  const withMap: Record<string, string> = { 'rusty-anchor': TAVERN_MAP, 'greywater-coast': COAST_MAP };
  run('batch', {
    label: 'Practice campaign',
    ops: [
      ...SEED_NODES.map((n) => ({
        command: 'create_node',
        args: {
          id: n.id, type: n.type, title: n.title, summary: n.summary, body: n.body, readAloud: n.readAloud, tags: n.tags, poolHint: n.poolHint,
          fields: { ...n.fields, ...(withMap[n.id] ? { mapId: withMap[n.id] } : {}) },
          ...(n.at ? { place: 'canvas', x: n.at.x, y: n.at.y } : {}),
        },
      })),
      ...SEED_EDGES.map((e) => ({ command: 'link', args: e })),
    ],
  });

  // pictures that are on their cards from the start (the rest is "generated" during the tour)
  const attach: Record<string, string[]> = {};
  for (const p of PICTURES) if (p.seed && p.nodeId && installPicture(imagesDir, p.file)) (attach[p.nodeId] ??= []).push(p.file);
  const coastPic = MAP_ASSETS[COAST_MAP].quick;
  if (installPicture(imagesDir, coastPic)) {
    attach['greywater-coast'] = [coastPic];
    const m = maps.get(COAST_MAP);
    m.renders = [coastPic];
    maps.save(m, { backup: 'none' });
  }
  const meta: Record<string, unknown> = {};
  for (const p of PICTURES) if (p.seed && installPicture(imagesDir, p.file)) meta[p.file] = { nodeId: p.nodeId ?? '', prompt: p.prompt, seed: 1, kind: p.kind, w: 0, h: 0, at: new Date().toISOString() };
  if (hasAsset(coastPic)) meta[coastPic] = { nodeId: 'greywater-coast', prompt: 'Greywater and the coast', seed: 1, kind: 'map', w: 1344, h: 768, at: new Date().toISOString() };
  if (Object.keys(meta).length) fs.writeFileSync(`${imagesDir}/index.json`, JSON.stringify(meta, null, 1));
  store.transact('system', 'Pictures', (tx) => {
    for (const [id, files] of Object.entries(attach)) tx.putNode({ ...tx.requireNode(id), images: files });
  });

  // the table has entries already; the lore book gives the Library something to show
  store.world.add(WORLD_BOOK.name, WORLD_BOOK.text);
  store.world.setSummary(WORLD_BOOK.name, WORLD_BOOK.summary);

  // seeding is not history the user should step back through
  store.resetHistory();
}
