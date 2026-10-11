import fs from 'node:fs';
import path from 'node:path';
import {
  CONSOLIDATE_DENOISE, FLOORS, LINE_DENOISE, consolidatePrompt, corridorSvg, derivedWalls, describeGroups, describeRegionGroups, fallbackGroupPrompt, fallbackRegionPrompt,
  groupMasks, groupProps, groupRegion, cropFor, imageSize, isLineKind, lineStageWhat, lineStages, linesDrawnSvg, regionCrops, regionKind, regionLegend, regionMasks,
  renderSvg, ringMaskSvg, terrainLegend, toPng, usedKinds,
  type Backend, type FloorChar, type GroupInfo, type MapDoc, type PropGroup, type RegionGroup, type RegionGroupInfo, type StyleConfig,
} from './maps.js';
import { ComfyError } from './comfy.js';
import type { RunCtx } from './images.js';
import type { ImageApi } from './store.js';

// ---------------------------------------------------------------------------
// The precise, two-step way to paint a battle map.
//   Step 1  TERRAIN  the empty place only (floors, walls, doors) -> the model is free to be creative;
//                    the GM accepts it or regenerates it.
//   Step 2  PROPS    every prop group (touching props of one kind = one object) is inpainted into its
//                    exact place with its own AI-written prompt, one after the other; the GM accepts it
//                    or regenerates it.
// Both steps are ordinary jobs in the image queue. The quick way (one img2img pass) lives in commands.ts.
// ---------------------------------------------------------------------------

export type Fidelity = 'faithful' | 'balanced' | 'painterly';

/** Denoise of the terrain step: low keeps the plan exactly, high is freer (above ~0.85 the layout starts to drift). */
const TERRAIN_DENOISE: Record<Fidelity, number> = { faithful: 0.62, balanced: 0.72, painterly: 0.8 };

/** Maps with few walls give the model less to hold on to, so they get a little less freedom. */
export function terrainDenoise(m: MapDoc, fidelity: Fidelity = 'balanced'): number {
  const wallPoor = derivedWalls(m).length < (m.grid.cols + m.grid.rows) * 0.75;
  return Math.round((TERRAIN_DENOISE[fidelity] - (wallPoor ? 0.05 : 0)) * 100) / 100;
}

const TERRAIN_NEGATIVE = 'furniture, tables, chairs, barrels, crates, chests, objects, props, people, characters, text, letters, watermark, grid lines, perspective view, 3d render, photograph';

/** Every prop group is painted in this look (validated: bold outline + cast shadow make objects read at a glance). */
const PROP_STYLE =
  'Hand-painted fantasy RPG battlemap, top-down orthographic view from directly above. A bold, clearly readable game object with a thick dark ink outline, rich colour, high contrast and a strong cast shadow on the floor around it, painted in exactly the same art style and lighting as the rest of the map:';
const PROP_NEGATIVE = 'blurry, text, watermark';

export { fallbackGroupPrompt };

// ------------------------------- prompts written by the AI ---------------------------------

/** Floors, rooms and size in a line or two: what the AI may use to describe the empty place. */
function placeFacts(m: MapDoc): string {
  const counts = new Map<string, number>();
  for (const row of m.rows) for (const ch of row) if (ch !== '.') counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const floors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${FLOORS[c as FloorChar]?.name ?? c} ${Math.round((n / total) * 100)}%`);
  return `${m.grid.cols}x${m.grid.rows} cells; floors: ${floors.join(', ')}; room labels: ${m.labels.map((l) => l.text).join(', ') || 'none'}`;
}

/** Ask the AI to turn the GM's description of the place into a description of the EMPTY shell (the model invents furniture otherwise). */
export function shellRequest(m: MapDoc, place: string): string {
  const facts = placeFacts(m);
  return [
    'You prepare the FIRST of two painting steps for a top-down tabletop battle map: the empty place only. Furniture and objects are painted in later, one by one.',
    '',
    `The GM describes the place: "${place.trim()}"`,
    `Facts about the plan: ${facts}`,
    '',
    'Rewrite it as ONE description (30-60 words, English) of the bare architectural shell: structure, floor materials, walls, doors, surroundings, light and mood. Rules: nothing inside the rooms; no furniture, objects, people or activities; do not use words that imply contents (tavern, taproom, kitchen, library, barracks, throne room…) — describe rooms by size and floor instead (a large room with a worn plank floor, a smaller flagstone room); keep the materials, light and mood the GM wants. Begin with "Bare" or "Empty" and say "nothing inside".',
    '',
    'Answer with ONLY the description, no quotes, no commentary.',
  ].join('\n');
}

export function groupPromptRequest(place: string, infos: GroupInfo[]): string {
  return [
    'You write inpainting prompts for a tabletop battle-map generator.',
    '',
    `PLACE: ${place.trim()}`,
    '',
    'The finished, EMPTY painted battle map (seen from directly above) is described above; you cannot see it. Each group below is a spot where an object (or a row/cluster of the same object, treated as ONE object) will now be painted in by an inpainting model.',
    '',
    "For every group below, write ONE inpainting prompt (12-30 words) describing exactly what should be painted inside that box, as seen from directly above: the object, its material, condition, notable details, and how it sits on the floor named in floorUnder. Rules: a group with count>1 is ONE continuous thing or an orderly row (e.g. 5 touching tables = one long banquet table, 5 barrels in a row = a row of barrels); respect extentCells (width x height) so the object fills the box; when count>1 and the items are individual things (chairs, stools, barrels, crates, trees, rocks) say exactly how many separate items stand in the row and that each is clearly distinct, and describe each from above as it really looks (a chair = square seat with a backrest bar on one side; a barrel = round lid with hoops; a tree = round leafy canopy); match the map's look and lighting; top-down only; no people, no text, no perspective words like 'front view'. CONTRAST IS ESSENTIAL: the object must stand out clearly from the floor named in floorUnder, so choose materials and colours that differ strongly from it (on pale marble or stone use dark basalt, black iron, bronze, rust-red, dark wood; on dark floors use paler materials; on grass or sand use dark wood, stone or metal) and mention a crisp dark outline and a distinct cast shadow falling to the lower right. Use natural, believable colours (leaves in ordinary greens and yellow-greens, never blue or teal; wood brown; stone grey) unless the place description says the place is magical or unnatural. Do not repeat the style words, only describe the object.",
    '',
    'GROUPS (JSON):',
    JSON.stringify(infos),
    '',
    'Answer with ONLY a JSON object mapping group id to prompt string, e.g. {"g1": "...", "g2": "..."}. No markdown fences.',
  ].join('\n');
}

/** Pull the id -> prompt object out of an AI answer; missing or silly entries get the fallback for their kind. */
export function parseGroupPrompts(text: string, infos: GroupInfo[]): { prompts: Record<string, string>; fromAi: number } {
  let raw: Record<string, unknown> = {};
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      raw = JSON.parse(text.slice(a, b + 1));
    } catch { /* fall back below */ }
  }
  const prompts: Record<string, string> = {};
  let fromAi = 0;
  for (const g of infos) {
    const v = typeof raw[g.id] === 'string' ? (raw[g.id] as string).trim().replace(/\s+/g, ' ') : '';
    if (v.split(/\s+/).length >= 3 && v.length <= 500) {
      prompts[g.id] = v;
      fromAi++;
    } else prompts[g.id] = fallbackGroupPrompt(g);
  }
  return { prompts, fromAi };
}

// ------------------------------- the two jobs -------------------------------------------------

export interface PaintAi { backend: Backend; model?: string }

/** Step 1 as a queue job runner: describe the empty shell, then img2img from the layout-only picture. */
export function terrainRunner(images: ImageApi, m: MapDoc, place: string, fidelity: Fidelity, ai: PaintAi) {
  const { w, h } = imageSize(m);
  return async (ctx: RunCtx): Promise<Buffer> => {
    ctx.phase('Describing the empty place…');
    let shell = '';
    try {
      shell = (await images.ai(ai.backend, shellRequest(m, place), ai.model)).trim().replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ');
    } catch (e) {
      console.error('[mappaint] shell description failed, using the GM text', e);
    }
    if (shell.split(/\s+/).length < 6 || ctx.signal.aborted) shell = `${place.trim().replace(/[.\s]+$/, '')}. Completely empty, bare floors, nothing inside`;
    const style = images.style();
    const prompt = `${shell.replace(/[.\s]+$/, '')}. ${style.mapSuffix}, completely empty and unfurnished, bare floors, no furniture, no objects. ${terrainLegend(m)}`;
    ctx.phase('Painting the terrain…');
    const png = toPng(renderSvg(m, 'terrain'));
    const name = await images.comfy.uploadImage(png, `pnp-${m.id}-terrain.png`);
    const wf = images.comfy.buildImg2Img(prompt, `${style.negative}, ${TERRAIN_NEGATIVE}`, name, ctx.seed, terrainDenoise(m, fidelity));
    return ctx.generate(wf, (w * h) / 1e6);
  };
}

/** Step 2 as a queue job runner: write the prompts, then inpaint the groups one after the other onto the accepted terrain. */
export function propsRunner(images: ImageApi, m: MapDoc, terrainFile: Buffer, place: string, ai: PaintAi, given?: Record<string, string>, onWritten?: (written: Record<string, string>) => void) {
  const { w: W, h: H, cell } = imageSize(m);
  const groups = groupProps(m);
  const withRing = m.consolidate !== false && !!ringMaskSvg(m);
  return async (ctx: RunCtx): Promise<Buffer> => {
    const infos = describeGroups(m, groups);
    // the GM's own wording wins as it is; the AI writes the rest (and without an AI the plain default of the kind is used)
    const own: Record<string, string> = {};
    for (const g of infos) {
      const v = (given?.[g.id] ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (v) own[g.id] = v;
    }
    const open = infos.filter((g) => !own[g.id]);
    let prompts: Record<string, string> = { ...own };
    const written: Record<string, string> = {};
    if (open.length) {
      ctx.phase('Writing the painting prompts…');
      let r: Record<string, string>;
      try {
        r = parseGroupPrompts(await images.ai(ai.backend, groupPromptRequest(place, open), ai.model), open).prompts;
      } catch (e) {
        console.error('[mappaint] prompt writing failed, using plain prompts', e);
        r = parseGroupPrompts('', open).prompts;
      }
      for (const g of open) written[g.id] = r[g.id];
      prompts = { ...prompts, ...written };
      onWritten?.(written);
    }
    let current = terrainFile;
    const n = groups.length;
    const style = images.style();
    const steps = n + (withRing ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (ctx.signal.aborted) throw new ComfyError('Cancelled.');
      const g: PropGroup = groups[i];
      ctx.phase(`Painting props ${i + 1}/${n} · ${g.kind.replace(/_/g, ' ')}${g.props.length > 1 ? ` ×${g.props.length}` : ''}`);
      const crop = cropFor(g, cell, W, H);
      const masks = groupMasks(g, crop, cell);
      const base = await images.comfy.uploadImage(current, `pnp-${m.id}-${ctx.seed}-base.png`);
      const sample = await images.comfy.uploadImage(toPng(masks.sample), `pnp-${m.id}-${ctx.seed}-ms.png`);
      const compose = await images.comfy.uploadImage(toPng(masks.compose), `pnp-${m.id}-${ctx.seed}-mc.png`);
      const wf = images.comfy.buildInpaint(`${PROP_STYLE} ${prompts[g.id].replace(/[.\s]+$/, '')}.`, `${style.negative}, ${PROP_NEGATIVE}`, { image: base, sampleMask: sample, composeMask: compose, crop }, ctx.seed + i + 1);
      current = await ctx.generate(wf, (crop.tw * crop.th) / 1e6, [i / steps, (i + 1) / steps]);
    }
    if (withRing && !ctx.signal.aborted) current = await consolidate(images, ctx, m, current, place, style.mapSuffix, [n / steps, 1]);
    return current;
  };
}

// ------------------------------- region maps: terrain, then structures -------------------------

/** Denoise of the region terrain step (a flat sketch has no walls to hold on to, so it is a little tighter than a battle map's). */
const REGION_TERRAIN_DENOISE: Record<Fidelity, number> = { faithful: 0.62, balanced: 0.72, painterly: 0.8 };
export const regionTerrainDenoise = (fidelity: Fidelity = 'balanced') => REGION_TERRAIN_DENOISE[fidelity];

const REGION_TERRAIN_NEGATIVE =
  'buildings, houses, towns, villages, cities, castles, towers, tents, ships, boats, bridges, people, characters, text, letters, labels, watermark, grid lines, perspective, oblique view, tilted view, horizon, sky, aerial view from an angle, depth of field, 3d render, photograph';

/** How region maps look: the campaign's own wording, else its battle-map look reworded for an overland map. */
export function regionLook(style: StyleConfig): string {
  const own = style.regionSuffix?.trim();
  if (own) return own.replace(/[.\s]+$/, '');
  return style.mapSuffix.replace(/[.\s]+$/, '').replace(/\b(?:tabletop\s+)?(?:RPG\s+)?battle\s*map\b/i, 'overland map');
}

/** Every structure is painted in this look: small, readable, same scale and lighting as the land around it. */
const REGION_PROP_STYLE =
  'Hand-painted overland map seen from high above, top-down. A small, clearly readable map feature with a crisp dark outline, rich colour and a short cast shadow to the lower right, painted at the scale of the land around it in exactly the same art style and lighting:';
const REGION_PROP_NEGATIVE = 'blurry, text, letters, labels, watermark, people, perspective view, giant, close-up';

/** What each terrain kind covers, roughly (shoelace / ellipse areas; lines and spots are named only). */
function terrainFacts(m: MapDoc): string {
  const area = new Map<string, number>();
  const lines = new Set<string>();
  for (const s of m.shapes) {
    const k = regionKind(s.kind, m.kinds);
    if (k.layer === 'structure') continue;
    if (s.type === 'path') lines.add(k.name.toLowerCase());
    let a = 0;
    if (s.type === 'polygon') {
      for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) a += (s.points[j][0] + s.points[i][0]) * (s.points[j][1] - s.points[i][1]);
      a = Math.abs(a) / 2;
    } else if (s.type === 'ellipse') {
      const [rx, ry] = s.points[1] ?? [s.r ?? 30, s.r ?? 30];
      a = Math.PI * rx * ry;
    } else if (s.type === 'path') {
      let len = 0;
      for (let i = 0; i + 1 < s.points.length; i++) len += Math.hypot(s.points[i + 1][0] - s.points[i][0], s.points[i + 1][1] - s.points[i][1]);
      a = len * (s.width ?? k.width ?? 14);
    }
    area.set(k.name.toLowerCase(), (area.get(k.name.toLowerCase()) ?? 0) + a);
  }
  const total = m.size.w * m.size.h;
  const parts = [...area.entries()].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1]).map(([n, a]) => `${n} ${Math.max(1, Math.round((a / total) * 100))}%`);
  const bg = regionKind(m.background ?? 'land', m.kinds).name.toLowerCase();
  return `${m.size.w}x${m.size.h}px; base: ${bg}; terrain areas: ${parts.join(', ') || 'none'}; lines (rivers, roads): ${[...lines].join(', ') || 'none'}`;
}

/** Ask the AI to turn the GM's description of the map into a description of the bare land (the model invents towns otherwise). */
export function regionTerrainRequest(m: MapDoc, place: string): string {
  return [
    'You prepare the FIRST of two painting steps for a top-down overland (region) map: the bare land only. Towns, buildings, camps, castles, ruins, bridges, harbours and other structures are painted in later, one by one, into exactly their places.',
    '',
    `The GM describes the map: "${place.trim()}"`,
    `Facts about the sketch: ${terrainFacts(m)}`,
    '',
    'Rewrite it as ONE description (30-60 words, English) of the bare landscape: terrain types and where they lie, colours, vegetation, water, ground texture, light and mood. Rules: nothing built or inhabited — no towns, villages, houses, farms, camps, castles, ruins, ports, ships, bridges or people, and do not use words that imply them (kingdom, settlement, trade route, battlefield…); keep the terrain, climate, season and mood the GM wants; do NOT mention rivers, streams, roads, paths or railways at all: they are painted in later along their own lines, so the land must not contain any of its own. Begin with "Empty" or "Wild" and say "no buildings or settlements".',
    '',
    'Answer with ONLY the description, no quotes, no commentary.',
  ].join('\n');
}

export function regionGroupRequest(place: string, style: StyleConfig, infos: RegionGroupInfo[]): string {
  return [
    'You write inpainting prompts for an overland (region) map generator.',
    '',
    `PLACE / MAP: ${place.trim()}`,
    `WORLD LOOK: ${style.suffix.trim()}${style.regionSuffix ? `; map look: ${style.regionSuffix.trim()}` : ''}`,
    '',
    'The finished painting of the EMPTY land (seen from high above) is described above; you cannot see it. Each group below is a spot where one structure or feature (or a few of the same kind, treated as ONE) will now be painted into the land by an inpainting model.',
    '',
    'For every group below write ONE inpainting prompt (15-40 words) describing exactly what is painted inside that shape, as seen from high above on a map. Rules: use kindPrompt as the base meaning and shapePrompts (the GM\'s own words) as the truth when given; decide what things look like from the WORLD LOOK — its era, technology and culture (a camp is tipis, nomad yurts, canvas war tents or modern camping tents depending on the world; a house is a thatched cottage, a timber-frame house or a suburban home; a hospital is a field infirmary, a monastery hospice or a modern complex); the object is share of the map width, so paint a small, believable cluster in scale with the land, not a close-up, and when count>1 it is one group of that many close-together items; the object must stand out from the terrain named in under (crisp dark outline, a short cast shadow to the lower right, colours that contrast with it) and its edges meet the nearby terrain naturally (a port has water on the sea side, a bridge spans the water); use natural, believable colours unless the world is magical; top-down only; no people, no text, no labels, no perspective words. Do not repeat the style words, only describe the object.',
    '',
    'GROUPS (JSON):',
    JSON.stringify(infos),
    '',
    'Answer with ONLY a JSON object mapping group id to prompt string, e.g. {"g1": "...", "g2": "..."}. No markdown fences.',
  ].join('\n');
}

/** Pull the id -> prompt object out of an AI answer; missing or silly entries get the plain wording of their kind. */
export function parseRegionPrompts(text: string, infos: RegionGroupInfo[]): { prompts: Record<string, string>; fromAi: number } {
  let raw: Record<string, unknown> = {};
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      raw = JSON.parse(text.slice(a, b + 1));
    } catch { /* fall back below */ }
  }
  const prompts: Record<string, string> = {};
  let fromAi = 0;
  for (const g of infos) {
    const v = typeof raw[g.id] === 'string' ? (raw[g.id] as string).trim().replace(/\s+/g, ' ') : '';
    if (v.split(/\s+/).length >= 3 && v.length <= 500) {
      prompts[g.id] = v;
      fromAi++;
    } else prompts[g.id] = fallbackRegionPrompt(g);
  }
  return { prompts, fromAi };
}

/**
 * How hard the terrain pass insists on a flat plan view. The model likes painting fantasy maps in an oblique "bird's-eye"
 * perspective (mountains as side-on icons, a horizon); `strict` / `plan` push it to a straight-down view. Natural (default)
 * rated best on the kingdom and the valley, strict on the snow pass: a per-map choice.
 */
export type RegionView = 'default' | 'strict' | 'plan';
const VIEW_TEXT: Record<RegionView, string> = {
  default: 'A flat map, strictly straight down from above like a satellite image or a painted game map: no perspective, no horizon, no tilt, mountains and trees shown from above.',
  strict:
    'A plan view: the camera points straight down at 90 degrees, like an orthographic satellite image. No horizon, no sky, no tilt, no foreshortening. Mountains and hills are shown as top-down shaded relief with ridge lines, trees as round crowns seen from directly above, nothing is seen from the side.',
  plan:
    'A flat top-down topographic plan, drawn like a hillshaded survey map: strictly orthographic, camera straight down at 90 degrees, no horizon line, no sky, no clouds, no three-quarter or isometric view whatsoever. Relief is shown only by top-down hillshading and contour-like ridge lines; every tree is a round crown seen from directly above; coastlines and rivers are seen as plan outlines.',
};
const VIEW_NEGATIVE = 'three-quarter view, oblique view, isometric, side view, mountain icons seen from the side, horizon, sky, clouds, bird\'s-eye perspective, tilted camera, foreshortening';
const LINES_NEGATIVE = 'rivers, streams, roads, paths, railways, bridges';
/** What the line passes and the consolidate pass must never add. */
const NO_BUILD = 'buildings, houses, town, city, castle, tower, settlement';

export interface RegionTerrainOpts {
  /** override the denoise of the fidelity preset (experiments) */
  denoise?: number;
  view?: RegionView;
  /** override the denoise of the line passes (experiments) */
  lineDenoise?: number;
}

/** Number of full-picture generations the terrain job makes: the terrain itself plus one per line pass. */
export const terrainPasses = (m: MapDoc): number => (m.kind === 'region' ? 1 + lineStages(m).length : 1);

/**
 * Step 1 for a region map as a queue job runner: describe the bare land, paint the terrain from the flat sketch (no
 * structures, no rivers or roads), then paint the lines: rivers (water pass) and roads/rails/paths/bridges (land pass),
 * each pre-rendered into the picture, sampled as a whole and kept only inside its own corridor.
 */
export function regionTerrainRunner(images: ImageApi, m: MapDoc, place: string, fidelity: Fidelity, ai: PaintAi, opts: RegionTerrainOpts = {}) {
  const { w, h } = imageSize(m);
  return async (ctx: RunCtx): Promise<Buffer> => {
    ctx.phase('Describing the empty land…');
    let land = '';
    try {
      land = (await images.ai(ai.backend, regionTerrainRequest(m, place), ai.model)).trim().replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ');
    } catch (e) {
      console.error('[mappaint] land description failed, using the GM text', e);
    }
    if (land.split(/\s+/).length < 6 || ctx.signal.aborted) land = `${place.trim().replace(/[.\s]+$/, '')}. Empty wild land, no buildings or settlements`;
    land = land.replace(/[.\s]+$/, '');
    const style = images.style();
    const view = opts.view ?? m.view ?? 'default';
    const stages = lineStages(m);
    const total = 1 + stages.length;
    const prompt = `${land}. ${regionLook(style)}, completely empty land, nothing built, no buildings, no settlements, no text. ${VIEW_TEXT[view]} No rivers, no streams, no roads, no paths: bare ground only. ${regionLegend(m, true)}`;
    ctx.phase('Painting the terrain…');
    const png = toPng(renderSvg(m, 'terrain'));
    const name = await images.comfy.uploadImage(png, `pnp-${m.id}-terrain.png`);
    const negative = `${style.negative}, ${REGION_TERRAIN_NEGATIVE}, ${LINES_NEGATIVE}${view !== 'default' ? `, ${VIEW_NEGATIVE}` : ''}`;
    const wf = images.comfy.buildImg2Img(prompt, negative, name, ctx.seed, opts.denoise ?? regionTerrainDenoise(fidelity));
    let current = await ctx.generate(wf, (w * h) / 1e6, [0, 1 / total]);
    for (let i = 0; i < stages.length; i++) {
      if (ctx.signal.aborted) throw new ComfyError('Cancelled.');
      const st = stages[i];
      ctx.phase(st.group === 'water' ? 'Painting the rivers…' : 'Painting roads, rails and bridges…');
      const drawn = toPng(linesDrawnSvg(m, current.toString('base64'), st));
      const band = toPng(corridorSvg(m, st));
      const tag = `pnp-${m.id}-${ctx.seed}-l${i}`;
      const imgName = await images.comfy.uploadImage(drawn, `${tag}-drawn.png`);
      const orig = await images.comfy.uploadImage(current, `${tag}-orig.png`);
      const mask = await images.comfy.uploadImage(band, `${tag}-band.png`);
      const w2 = lineStageWhat(st);
      const text = `${land}. ${w2.what} Nothing is built anywhere. ${regionLook(style)}. One coherent painting, the same lighting and brush style everywhere.`;
      const neg = `${style.negative}, text, letters, labels, ${NO_BUILD}, ${w2.not}, distorted, blurry${view !== 'default' ? `, ${VIEW_NEGATIVE}` : ''}`;
      const rf = images.comfy.buildRefine(text, neg, { image: imgName, original: orig, mask }, ctx.seed + 1 + i, opts.lineDenoise ?? LINE_DENOISE);
      current = await ctx.generate(rf, (w * h) / 1e6, [(1 + i) / total, (2 + i) / total]);
    }
    return current;
  };
}

/** The last, optional step: blend everything painted in step 2 into the picture (ring around the objects, objects untouched). */
async function consolidate(images: ImageApi, ctx: RunCtx, m: MapDoc, current: Buffer, place: string, look: string, span: [number, number]): Promise<Buffer> {
  const masks = ringMaskSvg(m);
  if (!masks) return current;
  ctx.phase('Blending the objects into the picture…');
  const style = images.style();
  const tag = `pnp-${m.id}-${ctx.seed}-ring`;
  const image = await images.comfy.uploadImage(current, `${tag}.png`);
  const mask = await images.comfy.uploadImage(toPng(masks.svg), `${tag}-mask.png`);
  const wf = images.comfy.buildRefine(consolidatePrompt(place, look), `${style.negative}, text, letters, labels, new buildings, new objects, changed layout, distorted, blurry`, { image, mask, noiseMask: true }, ctx.seed + 77, CONSOLIDATE_DENOISE[m.kind]);
  return ctx.generate(wf, (masks.w * masks.h) / 1e6, span);
}

/** Step 2 for a region map: write the prompts, inpaint every structure onto the accepted terrain, then (optionally) consolidate. */
export function regionStructuresRunner(
  images: ImageApi, m: MapDoc, terrainFile: Buffer, place: string, ai: PaintAi,
  given?: Record<string, string>, onWritten?: (written: Record<string, string>) => void,
  only?: (g: RegionGroup) => boolean,
) {
  const { w: W, h: H } = imageSize(m);
  const groups = groupRegion(m).filter((g) => !only || only(g));
  const withRing = m.consolidate !== false && !!ringMaskSvg(m);
  return async (ctx: RunCtx): Promise<Buffer> => {
    const infos = describeRegionGroups(m, groups);
    const own: Record<string, string> = {};
    for (const g of infos) {
      const v = (given?.[g.id] ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (v) own[g.id] = v;
    }
    const open = infos.filter((g) => !own[g.id]);
    let prompts: Record<string, string> = { ...own };
    const written: Record<string, string> = {};
    const style = images.style();
    if (open.length) {
      ctx.phase('Writing the painting prompts…');
      let r: Record<string, string>;
      try {
        r = parseRegionPrompts(await images.ai(ai.backend, regionGroupRequest(place, style, open), ai.model), open).prompts;
      } catch (e) {
        console.error('[mappaint] prompt writing failed, using plain prompts', e);
        r = parseRegionPrompts('', open).prompts;
      }
      for (const g of open) written[g.id] = r[g.id];
      prompts = { ...prompts, ...written };
      onWritten?.(written);
    }
    const windows = groups.map((g) => regionCrops(g, W, H, { kinds: m.kinds }));
    const total = windows.reduce((n, c) => n + c.length, 0) + (withRing ? 1 : 0) || 1;
    let current = terrainFile;
    let done = 0;
    for (let i = 0; i < groups.length; i++) {
      const g: RegionGroup = groups[i];
      for (let j = 0; j < windows[i].length; j++) {
        if (ctx.signal.aborted) throw new ComfyError('Cancelled.');
        const crop = windows[i][j];
        ctx.phase(`Painting structures ${i + 1}/${groups.length} · ${regionKind(g.kind, m.kinds).name.toLowerCase()}${windows[i].length > 1 ? ` (part ${j + 1}/${windows[i].length})` : ''}`);
        const masks = regionMasks(g, crop, m.kinds);
        const base = await images.comfy.uploadImage(current, `pnp-${m.id}-${ctx.seed}-base.png`);
        const sample = await images.comfy.uploadImage(toPng(masks.sample), `pnp-${m.id}-${ctx.seed}-ms.png`);
        const compose = await images.comfy.uploadImage(toPng(masks.compose), `pnp-${m.id}-${ctx.seed}-mc.png`);
        const text = `${REGION_PROP_STYLE} ${prompts[g.id].replace(/[.\s]+$/, '')}.`;
        const wf = images.comfy.buildInpaint(text, `${style.negative}, ${REGION_PROP_NEGATIVE}`, { image: base, sampleMask: sample, composeMask: compose, crop }, ctx.seed + done + 1);
        current = await ctx.generate(wf, (crop.tw * crop.th) / 1e6, [done / total, (done + 1) / total]);
        done++;
      }
    }
    if (withRing && !ctx.signal.aborted) current = await consolidate(images, ctx, m, current, place, regionLook(style), [done / total, 1]);
    return current;
  };
}

/** Everything a region map's step 2 will paint, as the editor and the AI see it (groups with what is known about them). */
export function regionGroupInfos(m: MapDoc): RegionGroupInfo[] {
  return describeRegionGroups(m, groupRegion(m));
}

export { usedKinds };

// ------------------------------- estimates ----------------------------------------------------

export interface PaintEstimate {
  mode: 'quick' | 'staged';
  /** structure / prop groups of step 2 */
  groups: number;
  quickSeconds: number;
  /** step 1: the terrain, plus one pass per line pass on region maps */
  terrainSeconds: number;
  /** step 2: every group, plus the consolidate pass */
  propsSeconds: number;
  /** false = a typical-card guess; true = measured on this computer's own generations */
  measured: boolean;
}

export function estimatePaint(images: ImageApi, m: MapDoc): PaintEstimate {
  const { w, h, cell } = imageSize(m);
  const full = images.estimateSeconds((w * h) / 1e6);
  let propsSeconds = 0;
  let groups = 0;
  if (m.kind === 'region') {
    const gs = groupRegion(m);
    groups = gs.length;
    for (const g of gs)
      for (const c of regionCrops(g, w, h, { kinds: m.kinds })) propsSeconds += images.estimateSeconds((c.tw * c.th) / 1e6).seconds + 2;
  } else {
    const gs = groupProps(m);
    groups = gs.length;
    for (const g of gs) {
      const c = cropFor(g, cell, w, h);
      propsSeconds += images.estimateSeconds((c.tw * c.th) / 1e6).seconds + 2; // + uploads and VAE round trips
    }
  }
  if (groups && m.consolidate !== false) propsSeconds += full.seconds; // the consolidate pass is one full-picture generation
  return { mode: images.mapMode(), groups, quickSeconds: full.seconds, terrainSeconds: full.seconds * terrainPasses(m), propsSeconds, measured: full.measured };
}

/** The saved terrain picture of a map as bytes. */
export function readTerrain(imagesDir: string, file: string): Buffer {
  const p = path.join(imagesDir, path.basename(file));
  if (!fs.existsSync(p)) throw new Error(`The terrain image "${file}" is gone from the images folder — paint the terrain again.`);
  return fs.readFileSync(p);
}
