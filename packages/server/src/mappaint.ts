import fs from 'node:fs';
import path from 'node:path';
import { FLOORS, derivedWalls, describeGroups, fallbackGroupPrompt, groupMasks, groupProps, cropFor, imageSize, renderSvg, terrainLegend, toPng, type Backend, type FloorChar, type GroupInfo, type MapDoc, type PropGroup } from './maps.js';
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
      current = await ctx.generate(wf, (crop.tw * crop.th) / 1e6, [i / n, (i + 1) / n]);
    }
    return current;
  };
}

// ------------------------------- estimates ----------------------------------------------------

export interface PaintEstimate {
  mode: 'quick' | 'staged';
  /** battle maps only */
  groups: number;
  quickSeconds: number;
  terrainSeconds: number;
  propsSeconds: number;
  /** false = a typical-card guess; true = measured on this computer's own generations */
  measured: boolean;
}

export function estimatePaint(images: ImageApi, m: MapDoc): PaintEstimate {
  const { w, h, cell } = imageSize(m);
  const full = images.estimateSeconds((w * h) / 1e6);
  const groups = m.kind === 'battle' ? groupProps(m) : [];
  let propsSeconds = 0;
  for (const g of groups) {
    const c = cropFor(g, cell, w, h);
    propsSeconds += images.estimateSeconds((c.tw * c.th) / 1e6).seconds + 2; // + uploads and VAE round trips
  }
  return { mode: images.mapMode(), groups: groups.length, quickSeconds: full.seconds, terrainSeconds: full.seconds, propsSeconds, measured: full.measured };
}

/** The saved terrain picture of a map as bytes. */
export function readTerrain(imagesDir: string, file: string): Buffer {
  const p = path.join(imagesDir, path.basename(file));
  if (!fs.existsSync(p)) throw new Error(`The terrain image "${file}" is gone from the images folder — paint the terrain again.`);
  return fs.readFileSync(p);
}
