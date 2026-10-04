import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_COMFY, DEFAULT_STYLE, IMAGE_KINDS, slugify,
  type Actor, type ComfyConfig, type ImageJob, type ImageKind, type StyleConfig,
} from '@pnp/shared';
import { Comfy, ComfyError } from './comfy.js';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// Image generation queue: one ComfyUI job at a time (16 GB card), progress over
// the websocket, and every finished image is attached to its node as a normal
// undoable edit (so it animates like any other change).
// ---------------------------------------------------------------------------

type Workflow = ReturnType<Comfy['buildWorkflow']>;

/** A non-standard job (e.g. a map render): brings its own size, workflow builder and completion hook. */
export interface CustomJob {
  nodeId: string;
  kind: ImageJob['kind'];
  prompt: string;
  w: number;
  h: number;
  variants?: number;
  seed?: number;
  actor: Actor;
  build: (seed: number) => Promise<Workflow>;
  /** Called with the saved file name once the image exists. */
  after?: (file: string) => void;
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

  constructor(
    private store: Store,
    private dir: string,
    private broadcast: (job: ImageJob) => void,
    comfy?: Comfy,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.comfy = comfy ?? new Comfy(() => this.comfyConfig());
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
      const wf = custom ? await custom.build(job.seed) : this.comfy.buildWorkflow(this.fullPrompt(job.prompt), negative ?? this.style().negative, job.w, job.h, job.seed);
      let last = 0;
      const { bytes } = await this.comfy.generate(wf, {
        signal: ctl.signal,
        onProgress: (p) => {
          job.progress = p;
          if (p - last >= 0.1 || p === 1) {
            last = p;
            this.emit(job);
          }
        },
      });
      const file = `${slugify(job.nodeId)}-${job.seed}.png`;
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
      this.attach(job);
    } catch (e) {
      job.status = ctl.signal.aborted ? 'cancelled' : 'error';
      if (job.status === 'error') job.error = e instanceof ComfyError ? e.message : `Image generation failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.controllers.delete(job.id);
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
