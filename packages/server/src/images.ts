import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_COMFY, DEFAULT_STYLE, IMAGE_KINDS, slugify,
  type Actor, type ComfyConfig, type ImageJob, type ImageKind, type MapPaintMode, type StyleConfig,
} from '@pnp/shared';
import { Comfy, ComfyError } from './comfy.js';
import { runOnce, type Runner } from './style.js';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// Image generation queue: one ComfyUI job at a time (16 GB card), progress over
// the websocket, and every finished image is attached to its node as a normal
// undoable edit (so it animates like any other change).
// ---------------------------------------------------------------------------

type Workflow = ReturnType<Comfy['buildWorkflow']>;

/** What a multi-image job (e.g. painting all props of a map) gets to work with. */
export interface RunCtx {
  seed: number;
  signal: AbortSignal;
  comfy: Comfy;
  /** progress of the whole job, 0..1 */
  progress(p: number): void;
  /** what the job is doing right now ("Painting props 7/19"), shown next to the progress bar */
  phase(label: string): void;
  /** One ComfyUI generation. `megapixels` feeds the speed estimate; `span` maps its progress into [from, to] of the whole job. */
  generate(wf: Workflow, megapixels: number, span?: [number, number]): Promise<Buffer>;
}

/** A non-standard job (e.g. a map render): brings its own size, workflow builder (or a whole runner) and completion hook. */
export interface CustomJob {
  nodeId: string;
  kind: ImageJob['kind'];
  prompt: string;
  w: number;
  h: number;
  variants?: number;
  seed?: number;
  actor: Actor;
  /** One generation: build its workflow. Either this or `runner` is required. */
  build?: (seed: number) => Promise<Workflow>;
  /** Several generations (and other work) that end in one image: returns the final PNG. */
  runner?: (ctx: RunCtx) => Promise<Buffer>;
  /** Called with the saved file name once the image exists. */
  after?: (file: string) => void;
  /** Part of the saved file name, e.g. "terrain". */
  fileTag?: string;
  /** false = keep the image out of the node's pictures (work-in-progress images such as terrain candidates). Default true. */
  attach?: boolean;
}

export interface ImageServiceOptions {
  /** how maps are painted (a user setting for this computer); default quick */
  mapMode?: () => MapPaintMode;
  /** runs the AI once, headless (prompt writing); injectable for tests */
  ai?: Runner;
}

export interface ImageRequest {
  nodeId: string;
  prompt: string;
  kind?: ImageKind;
  variants?: number;
  seed?: number;
  negative?: string;
  actor: Actor;
}

interface Meta {
  nodeId: string;
  prompt: string;
  seed: number;
  kind: ImageKind;
  w: number;
  h: number;
  at: string;
}

export class ImageService {
  jobs: ImageJob[] = [];
  readonly comfy: Comfy;
  private queue: { job: ImageJob; negative?: string; custom?: CustomJob }[] = [];
  private running = false;
  private controllers = new Map<string, AbortController>();
  /** measured speed of this computer: milliseconds per megapixel per sampler step (null until the first image) */
  private msPerMpStep: number | null = null;
  readonly ai: Runner;
  private readonly modeFn: () => MapPaintMode;

  constructor(
    private store: Store,
    private dir: string,
    private broadcast: (job: ImageJob) => void,
    comfy?: Comfy,
    opts: ImageServiceOptions = {},
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.comfy = comfy ?? new Comfy(() => this.comfyConfig());
    this.ai = opts.ai ?? runOnce;
    this.modeFn = opts.mapMode ?? (() => 'quick');
  }

  /** How battle maps are painted right now (the user's setting). */
  mapMode(): MapPaintMode {
    return this.modeFn();
  }

  /** Rough seconds for generating `megapixels` on this computer: measured once an image has been made, else a typical 16 GB card. */
  estimateSeconds(megapixels: number): { seconds: number; measured: boolean } {
    const perMpStep = this.msPerMpStep ?? 9500; // ~77 s per megapixel at 8 steps on a Quadro RTX 5000 (the dev machine)
    return { seconds: (perMpStep * this.comfyConfig().steps * megapixels) / 1000, measured: this.msPerMpStep !== null };
  }
  private noteSpeed(ms: number, megapixels: number) {
    if (megapixels <= 0.05 || ms < 500) return;
    const v = ms / (megapixels * Math.max(1, this.comfyConfig().steps));
    this.msPerMpStep = this.msPerMpStep === null ? v : this.msPerMpStep * 0.6 + v * 0.4;
  }

  comfyConfig(): ComfyConfig {
    return { ...DEFAULT_COMFY, ...this.store.state.meta.comfy };
  }

  style(): StyleConfig {
    return { ...DEFAULT_STYLE, ...this.store.state.meta.style };
  }

  /** The prompt as sent to ComfyUI: the request + the campaign's style suffix. */
  fullPrompt(prompt: string): string {
    const base = prompt.trim().replace(/[.\s]+$/, '');
    const suffix = this.style().suffix.trim();
    return suffix ? `${base}. ${suffix}` : base;
  }

  enqueue(req: ImageRequest): ImageJob[] {
    const node = this.store.state.nodes[req.nodeId];
    if (!node || node.trashed) throw new Error(`Node "${req.nodeId}" not found`);
    if (!req.prompt.trim()) throw new Error('prompt is empty');
    const kind = req.kind ?? 'square';
    const { w, h } = IMAGE_KINDS[kind];
    const n = Math.max(1, Math.min(4, Math.round(req.variants ?? 1)));
    const made: ImageJob[] = [];
    for (let i = 0; i < n; i++) {
      const job: ImageJob = {
        id: randomBytes(4).toString('hex'),
        nodeId: req.nodeId,
        kind, prompt: req.prompt.trim(),
        seed: req.seed !== undefined ? req.seed + i : Math.floor(Math.random() * 2 ** 31),
        w, h, status: 'queued', progress: 0, actor: req.actor, at: new Date().toISOString(),
      };
      this.jobs.push(job);
      this.queue.push({ job, negative: req.negative });
      this.emit(job);
      made.push(job);
    }
    if (this.jobs.length > 60) this.jobs.splice(0, this.jobs.length - 60);
    void this.pump();
    return made;
  }

  enqueueCustom(c: CustomJob): ImageJob[] {
    const node = this.store.state.nodes[c.nodeId];
    if (!node || node.trashed) throw new Error(`Node "${c.nodeId}" not found`);
    if (!c.build && !c.runner) throw new Error('A custom image job needs a build() or a runner()');
    const n = Math.max(1, Math.min(4, Math.round(c.variants ?? 1)));
    const made: ImageJob[] = [];
    for (let i = 0; i < n; i++) {
      const job: ImageJob = {
        id: randomBytes(4).toString('hex'), nodeId: c.nodeId, kind: c.kind, prompt: c.prompt,
        seed: c.seed !== undefined ? c.seed + i : Math.floor(Math.random() * 2 ** 31),
        w: c.w, h: c.h, status: 'queued', progress: 0, actor: c.actor, at: new Date().toISOString(),
      };
      this.jobs.push(job);
      this.queue.push({ job, custom: c });
      this.emit(job);
      made.push(job);
    }
    if (this.jobs.length > 60) this.jobs.splice(0, this.jobs.length - 60);
    void this.pump();
    return made;
  }

  cancel(jobId?: string) {
    for (const q of [...this.queue]) {
      if (!jobId || q.job.id === jobId) {
        this.queue.splice(this.queue.indexOf(q), 1);
        q.job.status = 'cancelled';
        this.emit(q.job);
      }
    }
    for (const [id, c] of this.controllers) if (!jobId || id === jobId) c.abort();
  }

  private emit(job: ImageJob) {
    this.broadcast({ ...job });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) await this.run(next.job, next.negative, next.custom);
    } finally {
      this.running = false;
    }
  }

  private async run(job: ImageJob, negative?: string, custom?: CustomJob) {
    const ctl = new AbortController();
    this.controllers.set(job.id, ctl);
    job.status = 'running';
    this.emit(job);
    try {
      let last = 0;
      const report = (p: number) => {
        job.progress = Math.max(0, Math.min(1, p));
        if (job.progress - last >= 0.05 || job.progress === 1) {
          last = job.progress;
          this.emit(job);
        }
      };
      const timed = async (wf: Workflow, megapixels: number, onProgress: (p: number) => void): Promise<Buffer> => {
        const t = Date.now();
        const { bytes } = await this.comfy.generate(wf, { signal: ctl.signal, onProgress });
        this.noteSpeed(Date.now() - t, megapixels);
        return bytes;
      };
      let bytes: Buffer;
      if (custom?.runner) {
        bytes = await custom.runner({
          seed: job.seed, signal: ctl.signal, comfy: this.comfy, progress: report,
          phase: (label) => {
            job.phase = label;
            this.emit(job);
          },
          generate: (wf, megapixels, span = [0, 1]) => timed(wf, megapixels, (p) => report(span[0] + (span[1] - span[0]) * p)),
        });
      } else {
        const wf = custom ? await custom.build!(job.seed) : this.comfy.buildWorkflow(this.fullPrompt(job.prompt), negative ?? this.style().negative, job.w, job.h, job.seed);
        bytes = await timed(wf, (job.w * job.h) / 1e6, report);
      }
      const file = `${slugify(job.nodeId)}${custom?.fileTag ? `-${custom.fileTag}` : ''}-${job.seed}.png`;
      fs.writeFileSync(path.join(this.dir, file), bytes);
      this.record(file, { nodeId: job.nodeId, prompt: job.prompt, seed: job.seed, kind: job.kind as ImageKind, w: job.w, h: job.h, at: new Date().toISOString() });
      job.file = file;
      try {
        custom?.after?.(file);
      } catch (e) {
        console.error('[images] after-hook failed', e);
      }
      job.status = 'done';
      job.progress = 1;
      job.phase = undefined;
      if (custom?.attach !== false) this.attach(job);
    } catch (e) {
      job.status = ctl.signal.aborted ? 'cancelled' : 'error';
      if (job.status === 'error') job.error = e instanceof ComfyError ? e.message : `Image generation failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.controllers.delete(job.id);
      job.phase = undefined;
      this.emit(job);
    }
  }

  /** Attach the finished image to its node (undoable, animated like any edit). */
  private attach(job: ImageJob) {
    const n = this.store.state.nodes[job.nodeId];
    if (!n || n.trashed || !job.file) return; // node vanished meanwhile: the file stays in the gallery folder
    this.store.transact(job.actor, `Image for “${n.title}”`, (tx) => {
      tx.putNode({ ...n, images: [...n.images, job.file!], updatedAt: new Date().toISOString() });
    });
  }

  // --- gallery metadata (prompt / seed per file) -----------------------------------------
  private get metaFile() {
    return path.join(this.dir, 'index.json');
  }
  meta(): Record<string, Meta> {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      return {};
    }
  }
  private record(file: string, m: Meta) {
    const all = this.meta();
    all[file] = m;
    fs.writeFileSync(this.metaFile, JSON.stringify(all, null, 1));
  }
}
