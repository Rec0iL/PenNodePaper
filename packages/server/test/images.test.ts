import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageJob } from '@pnp/shared';
import { Comfy, ComfyError } from '../src/comfy.js';
import { runCommand } from '../src/commands.js';
import { ImageService } from '../src/images.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
let svc: ImageService;
let seen: ImageJob[];
let order: number[];
let fail: string | null;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

class FakeComfy extends Comfy {
  async generate(wf: any, opts: any) {
    const seed = wf['13'].inputs.seed as number;
    order.push(seed);
    opts.onProgress?.(0.5);
    await new Promise((r) => setTimeout(r, 15));
    if (opts.signal?.aborted) throw new ComfyError('Cancelled.');
    if (fail) throw new ComfyError(fail);
    return { bytes: Buffer.from(`png-${seed}`), filename: 'x.png' };
  }
}

const idle = async () => {
  for (let i = 0; i < 200 && svc.jobs.some((j) => j.status === 'queued' || j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-img-'));
  store = new Store(new Persistence(dir));
  seen = [];
  order = [];
  fail = null;
  svc = new ImageService(store, path.join(dir, 'images'), (j) => seen.push(j), new FakeComfy());
  store.images = svc;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('image queue', () => {
  it('runs variants one at a time, attaches each image, first one is the cover', async () => {
    const id = run('create_node', { type: 'npc', title: 'Garrick' }).id;
    const r = run('generate_image', { nodeId: id, prompt: 'A weathered smith with soot-black hands', kind: 'portrait', variants: 3, seed: 100 });
    expect(r.queued.map((q: any) => q.seed)).toEqual([100, 101, 102]);
    expect(r.queued[0].size).toBe('832x1216');
    await idle();
    expect(order).toEqual([100, 101, 102]); // sequential, in order
    const imgs = store.state.nodes[id].images;
    expect(imgs).toEqual([`${id}-100.png`, `${id}-101.png`, `${id}-102.png`]);
    expect(fs.readFileSync(path.join(dir, 'images', imgs[0]), 'utf8')).toBe('png-100');
    expect(svc.meta()[imgs[1]]).toMatchObject({ nodeId: id, seed: 101, kind: 'portrait' });
    // finished images arrive as normal batches (so they animate + are undoable), attributed to the requester
    const last = store.history.at(-1)!;
    expect(last.actor).toBe('claude');
    expect(last.events[0]).toMatchObject({ type: 'node.updated' });
    store.undo();
    expect(store.state.nodes[id].images).toHaveLength(2);
  });

  it('appends the campaign style to the prompt', () => {
    store.state.meta.style = { suffix: 'oil painting' };
    expect(svc.fullPrompt('A tavern at night. ')).toBe('A tavern at night. oil painting');
    expect(svc.comfy.buildWorkflow('p', 'n', 64, 64, 1)['13'].inputs.steps).toBe(8);
  });

  it('reports errors on the job and keeps going', async () => {
    const id = run('create_node', { type: 'scene', title: 'Cove' }).id;
    fail = 'ComfyUI is not reachable';
    run('generate_image', { nodeId: id, prompt: 'Smugglers under the cliffs' });
    await idle();
    expect(svc.jobs.at(-1)).toMatchObject({ status: 'error', error: 'ComfyUI is not reachable' });
    expect(store.state.nodes[id].images).toEqual([]);
    fail = null;
    run('generate_image', { nodeId: id, prompt: 'Smugglers under the cliffs again' });
    await idle();
    expect(store.state.nodes[id].images).toHaveLength(1);
  });

  it('cancel stops queued jobs and the running one', async () => {
    const id = run('create_node', { type: 'scene', title: 'Cove' }).id;
    run('generate_image', { nodeId: id, prompt: 'Smugglers under the cliffs', variants: 3 });
    svc.cancel();
    await idle();
    expect(svc.jobs.every((j) => j.status === 'cancelled')).toBe(true);
    expect(store.state.nodes[id].images).toEqual([]);
  });

  it('cover / remove commands, and a deleted node does not break a finishing job', async () => {
    const id = run('create_node', { type: 'npc', title: 'A' }).id;
    run('generate_image', { nodeId: id, prompt: 'portrait of a guard', variants: 2, seed: 5 });
    await idle();
    const [a, b] = store.state.nodes[id].images;
    run('set_cover_image', { nodeId: id, file: b });
    expect(store.state.nodes[id].images[0]).toBe(b);
    run('remove_image', { nodeId: id, file: a });
    expect(store.state.nodes[id].images).toEqual([b]);
    expect(() => run('set_cover_image', { nodeId: id, file: 'nope.png' })).toThrow();

    const gone = run('create_node', { type: 'npc', title: 'Gone' }).id;
    run('generate_image', { nodeId: gone, prompt: 'portrait of a ghost' });
    run('delete_node', { id: gone });
    await idle();
    expect(svc.jobs.at(-1)!.status).toBe('done'); // finished, file kept, no crash
    expect(store.state.nodes[gone].images).toEqual([]);
  });
});
