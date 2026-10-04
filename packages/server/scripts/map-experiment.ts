// Experiment: layout -> control image -> ComfyUI img2img at several denoise strengths.
//   npx tsx scripts/map-experiment.ts <outDir> [denoise,denoise,...]
import fs from 'node:fs';
import path from 'node:path';
import { Comfy } from '../src/comfy.js';
import { CONTROL_LEGEND, applyOps, imageSize, newMap, renderSvg, toPng } from '../src/maps.js';

const out = process.argv[2] ?? '/tmp';
const denoises = (process.argv[3] ?? '0.6,0.75,0.9').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });

const m = newMap('tavern', 'Rusty Anchor', 'battle', 24, 16);
applyOps(m, [
  { op: 'room', x: 2, y: 2, w: 12, h: 9, floor: 'wood', name: 'Taproom' },
  { op: 'room', x: 15, y: 2, w: 7, h: 5, floor: 'stone', name: 'Kitchen' },
  { op: 'room', x: 15, y: 8, w: 7, h: 6, floor: 'wood', name: 'Store' },
  { op: 'corridor', from: [6, 12], to: [6, 13], width: 2, floor: 'stone' },
  { op: 'door', x: 14, y: 4, side: 'w' },
  { op: 'door', x: 18, y: 7, side: 'n' },
  { op: 'door', x: 7, y: 10, side: 's' },
  { op: 'door', x: 2, y: 5, side: 'w', kind: 'door' },
  { op: 'prop', kind: 'fireplace', x: 3, y: 2, w: 3, h: 1 },
  { op: 'prop', kind: 'table', x: 5, y: 5, w: 3, h: 1 },
  { op: 'prop', kind: 'table', x: 9, y: 6, w: 3, h: 1 },
  { op: 'prop', kind: 'table', x: 5, y: 8, w: 2, h: 1 },
  { op: 'prop', kind: 'barrel', x: 12, y: 3 },
  { op: 'prop', kind: 'barrel', x: 12, y: 4 },
  { op: 'prop', kind: 'cauldron', x: 17, y: 3 },
  { op: 'prop', kind: 'crate', x: 16, y: 10 },
  { op: 'prop', kind: 'crate', x: 17, y: 10 },
  { op: 'prop', kind: 'chest', x: 20, y: 12 },
  { op: 'prop', kind: 'stairs_down', x: 6, y: 13, w: 2, h: 1 },
]);
const { w, h } = imageSize(m);
console.log('control image', w, 'x', h);
fs.writeFileSync(path.join(out, 'control.png'), toPng(renderSvg(m, 'control')));
fs.writeFileSync(path.join(out, 'preview.svg'), renderSvg(m, 'preview'));

const comfy = new Comfy();
const png = toPng(renderSvg(m, 'control'));
const fd = new FormData();
fd.append('image', new Blob([png], { type: 'image/png' }), 'pnp-experiment.png');
fd.append('overwrite', 'true');
const up = (await (await fetch('http://127.0.0.1:8188/upload/image', { method: 'POST', body: fd })).json()) as { name: string };
console.log('uploaded', up.name);

const prompt = `Top-down tabletop battle map of a medieval harbour tavern interior, seen from directly above, orthographic. Worn wooden plank floors in the taproom, flagstones in the kitchen, thick stone walls, sturdy wooden doors, big stone fireplace, long wooden tables, barrels and crates. Hand-painted RPG battlemap, warm lantern light, rich detail, no characters, no text, no grid. ${CONTROL_LEGEND}`;

for (const d of denoises) {
  const wf = comfy.buildWorkflow(prompt, 'text, characters, people, watermark, perspective, 3d render', w, h, 42) as Record<string, any>;
  wf['20'] = { class_type: 'LoadImage', inputs: { image: up.name } };
  wf['21'] = { class_type: 'VAEEncode', inputs: { pixels: ['20', 0], vae: ['3', 0] } };
  wf['13'].inputs.latent_image = ['21', 0];
  wf['13'].inputs.denoise = d;
  delete wf['12'];
  const t = Date.now();
  const r = await comfy.generate(wf, { onProgress: () => {} });
  const f = path.join(out, `render-d${d}.png`);
  fs.writeFileSync(f, r.bytes);
  console.log(`denoise ${d}: ${((Date.now() - t) / 1000).toFixed(0)}s -> ${f}`);
}
