import { createHash } from 'node:crypto';
import type { ComfyConfig } from '@pnp/shared';
import { Comfy, ComfyError, type GenerateJob } from '../comfy.js';
import type { Runner } from '../style.js';
import { MAP_ASSETS, PICTURES, hasAsset, readAsset } from './assets.js';

// ---------------------------------------------------------------------------
// Stand-ins for the parts of the app that need something installed: ComfyUI and an AI. In a practice campaign they
// play back the shipped pictures with realistic progress, and the app's real pipelines (queue, progress, the
// two-step map painting) run on top of them unchanged.
// ---------------------------------------------------------------------------

/** 1 = the pace you see in the tour; tests set PNP_TUTORIAL_SPEED=0 to skip the waiting. */
const speed = () => (process.env.PNP_TUTORIAL_SPEED !== undefined ? Number(process.env.PNP_TUTORIAL_SPEED) : 1);
/** wait like a real run would (scaled by the tutorial pace) */
export const pace = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * speed()));
const sleep = pace;
const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');

export class TutorialComfy extends Comfy {
  private used = new Set<string>();
  /** which terrain the props are being painted onto (0 = the first, 1 = the second): learnt from the picture they start from */
  private branch = new Map<string, number>();
  private terrainRuns = new Map<string, number>();
  private hashes = new Map<string, string>();

  constructor(cfg: () => ComfyConfig, private on: () => boolean) {
    super(cfg);
  }

  override get simulated() {
    return this.on();
  }

  override async alive() {
    return this.on() ? true : super.alive();
  }

  /** whether a real ComfyUI answers (the settings screen tells the truth about it, even while pictures are played back) */
  realAlive() {
    return super.alive();
  }

  override async uploadImage(bytes: Buffer, name: string): Promise<string> {
    if (!this.on()) return super.uploadImage(bytes, name);
    // the base picture of a props step tells which terrain this is (the terrain itself, or what was painted on it)
    if (/-base\.png$/.test(name)) {
      const mapId = /^pnp-(.+)-\d+-base\.png$/.exec(name)?.[1];
      const a = mapId ? MAP_ASSETS[mapId] : undefined;
      if (a) {
        const h = sha(bytes);
        const files = [...(a.terrains ?? []), ...(a.finals ?? [])];
        const k = files.findIndex((f) => hasAsset(f) && (this.hashes.get(f) ?? this.hashes.set(f, sha(readAsset(f))).get(f)) === h);
        if (k >= 0) this.branch.set(mapId!, k % Math.max(1, a.terrains?.length ?? 1));
      }
    }
    return name;
  }

  override async generate(
    wf: Parameters<Comfy['generate']>[0],
    opts: Parameters<Comfy['generate']>[1] = {},
  ): Promise<{ bytes: Buffer; filename: string }> {
    if (!this.on()) return super.generate(wf, opts);
    const load = Object.values(wf).find((n) => n.class_type === 'LoadImage')?.inputs.image;
    const { file, seconds } = this.pick(typeof load === 'string' ? load : '', opts.job);
    // progress like a real sampler: steady ticks, never instant
    const ticks = Math.max(1, Math.round((seconds * 1000) / 250));
    for (let i = 1; i <= ticks; i++) {
      if (opts.signal?.aborted) throw new ComfyError('Cancelled.');
      await sleep(250);
      opts.onProgress?.(Math.min(0.99, i / ticks));
    }
    if (!hasAsset(file)) throw new ComfyError(`The tutorial picture "${file}" is not part of this install.`);
    opts.onProgress?.(1);
    return { bytes: readAsset(file), filename: file };
  }

  /** The picture to play back, and how long "making" it takes. */
  private pick(loadName: string, job?: GenerateJob): { file: string; seconds: number } {
    const mapId = /^pnp-(.+?)(-terrain|-\d+-base)?\.png$/.exec(loadName)?.[1];
    const maps = mapId ? MAP_ASSETS[mapId] ?? MAP_ASSETS['the-rusty-anchor'] : undefined;
    if (maps && mapId) {
      if (/-terrain\.png$/.test(loadName) && maps.terrains?.length) {
        const n = this.terrainRuns.get(mapId) ?? 0;
        this.terrainRuns.set(mapId, n + 1);
        return { file: maps.terrains[n % maps.terrains.length], seconds: 7 };
      }
      if (/-base\.png$/.test(loadName) && maps.finals?.length) return { file: maps.finals[(this.branch.get(mapId) ?? 0) % maps.finals.length], seconds: 1.1 };
      return { file: maps.quick, seconds: 9 };
    }
    // a picture for a node: the one made for exactly that node, else a fresh one of its kind
    const mine = PICTURES.find((p) => p.nodeId === job?.nodeId);
    if (mine) return { file: mine.file, seconds: 5 };
    const kind = job?.kind;
    const of = PICTURES.filter((p) => p.kind === kind);
    const pool = of.length ? of : PICTURES;
    const fresh = pool.find((p) => !this.used.has(p.file)) ?? pool[0];
    this.used.add(fresh.file);
    return { file: fresh.file, seconds: 5 };
  }
}

/** The AI's part in painting a map (describing the empty place, writing the prop prompts) and in the style generator. */
export const tutorialAi: Runner = async (_backend, prompt) => {
  await sleep(1800);
  if (prompt.startsWith('You prepare the FIRST')) {
    return 'Bare stone-walled building shell with three separate rooms, nothing inside: a large room with worn wooden plank floor, a smaller room with grey flagstone floor, a smaller room with plank floor. Warm lantern light on the walls, thick dark stone walls, wooden doors.';
  }
  if (prompt.includes('art director')) {
    return JSON.stringify({
      suffix: 'moody painterly dark-fantasy illustration, damp fog and green lantern light, salt-weathered timber and black basalt, a muted teal and ochre palette, soft cinematic shadows',
      negative: 'text, watermark, signature, blurry, low quality, deformed, extra fingers, modern objects, bright cheerful colours',
      mapSuffix: 'hand-painted tabletop RPG battle map of a fog-bound harbour town, weathered planks and wet stone, warm lantern light, seen from directly above, orthographic top-down view, no characters, no text, no grid lines',
    });
  }
  return '{}'; // prop prompts: the app falls back to its plain ones
};
