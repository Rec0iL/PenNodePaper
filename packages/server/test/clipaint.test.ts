import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_KINDS, type PaintBackend } from '@pnp/shared';
import { cliPaint, newestPicture, type AgyPlaces, type CliPaintRequest, type CliRun } from '../src/clipaint.js';
import { Comfy } from '../src/comfy.js';
import { runCommand } from '../src/commands.js';
import { imageDimensions } from '../src/imagefile.js';
import { ImageService } from '../src/images.js';
import { toPng } from '../src/maps.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

const png = (w: number, h: number) => toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#a84"/></svg>`);

describe('painting with the image tool of agy / Codex', () => {
  let home: string;
  let places: AgyPlaces;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-agyhome-'));
    places = { brain: path.join(home, 'brain'), log: path.join(home, 'cli.log'), waitMs: 400, pollMs: 20 };
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('agy: only its own image subagent (never an MCP tool like comfy-mcp); the picture is taken from its conversation folder', async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const fake: CliRun = async (_bin, args, opts) => {
      calls.push({ args, cwd: opts.cwd });
      fs.mkdirSync(path.join(places.brain, 'c1'), { recursive: true });
      fs.writeFileSync(path.join(places.brain, 'c1', 'innkeeper_1.jpg'), png(500, 300));
      return { code: 0, out: JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', response: '' }), err: '' };
    };
    const bytes = await cliPaint({ backend: 'agy', prompt: 'an innkeeper', w: 768, h: 1024 }, fake, places);
    expect(imageDimensions(bytes)).toEqual({ w: 500, h: 300 });
    const prompt = calls[0].args[1];
    expect(prompt).toMatch(/portrait 3:4/);
    expect(prompt).toMatch(/image-generator subagent/);
    expect(prompt).toMatch(/not comfy-mcp/);
  });

  it('agy: sketch → art sends the sketch as image.png in its working folder; the path it answers with counts too', async () => {
    const out = path.join(home, 'answer.png');
    const fake: CliRun = async (_bin, args, opts) => {
      expect(fs.existsSync(path.join(opts.cwd, 'image.png'))).toBe(true);
      expect(args[1]).toMatch(/^Edit the image image\.png/);
      fs.writeFileSync(out, png(320, 400));
      return { code: 0, out: JSON.stringify({ status: 'SUCCESS', conversation_id: 'c2', response: out }), err: '' };
    };
    const bytes = await cliPaint({ backend: 'agy', prompt: 'an elf ranger', w: 768, h: 1024, reference: png(40, 50), referenceNote: 'it is a rough sketch' }, fake, places);
    expect(imageDimensions(bytes)).toEqual({ w: 320, h: 400 });
  });

  it('agy: a used-up quota and a run without picture are said plainly', async () => {
    const quota: CliRun = async () => {
      fs.appendFileSync(places.log, '{"error":"QUOTA_EXHAUSTED","quotaResetTimeStamp": "2030-01-01T10:00:00Z"}\n');
      return { code: 0, out: JSON.stringify({ status: 'SUCCESS', conversation_id: 'c3' }), err: '' };
    };
    await expect(cliPaint({ backend: 'agy', prompt: 'x', w: 64, h: 64 }, quota, places)).rejects.toThrow(/quota is used up.*comes back/);
    const nothing: CliRun = async () => ({ code: 0, out: JSON.stringify({ status: 'SUCCESS', conversation_id: 'c4', response: 'I cannot.' }), err: '' });
    await expect(cliPaint({ backend: 'agy', prompt: 'x', w: 64, h: 64 }, nothing, places)).rejects.toThrow(/agy made no picture.*I cannot/);
    const broken: CliRun = async () => ({ code: 1, out: JSON.stringify({ status: 'ERROR', error: 'not logged in' }), err: '' });
    await expect(cliPaint({ backend: 'agy', prompt: 'x', w: 64, h: 64 }, broken, places)).rejects.toThrow(/not logged in/);
  });

  it('Codex: runs in a scratch folder and takes the picture it saved there; the reference is attached with -i', async () => {
    const calls: { bin: string; args: string[]; input?: string }[] = [];
    const fake: CliRun = async (bin, args, opts) => {
      calls.push({ bin, args, input: opts.input });
      fs.writeFileSync(path.join(opts.cwd, 'out.png'), png(500, 300));
      return { code: 0, out: 'DONE', err: '' };
    };
    const bytes = await cliPaint({ backend: 'codex', prompt: 'an elf archer', w: 768, h: 1024, reference: png(40, 40) }, fake);
    expect(imageDimensions(bytes)).toEqual({ w: 500, h: 300 });
    expect(calls[0].bin).toBe('codex');
    expect(calls[0].args).toContain('-i');
    expect(calls[0].input).toContain('an elf archer');
  });

  it('finds the newest picture written during the run in the folders a CLI keeps its pictures in', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-newest-'));
    try {
      fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
      const old = path.join(d, 'old.png');
      fs.writeFileSync(old, png(4, 4));
      fs.utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
      const since = Date.now() - 1000;
      fs.writeFileSync(path.join(d, 'a', 'b', 'new.png'), png(4, 4));
      expect(newestPicture([d], since)).toBe(path.join(d, 'a', 'b', 'new.png'));
      expect(newestPicture([d], Date.now() + 60_000)).toBeNull();
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('the image queue with agy / Codex as the painter', () => {
  let dir: string;
  let store: Store;
  let painter: PaintBackend;
  let asked: CliPaintRequest[];
  const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;
  const idle = async (svc: ImageService) => {
    for (let i = 0; i < 300 && svc.jobs.some((j) => j.status === 'queued' || j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
  };
  class NoComfy extends Comfy {
    async generate(): Promise<never> {
      throw new Error('ComfyUI must not be used here');
    }
  }
  let svc: ImageService;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-clipaint-'));
    store = new Store(new Persistence(dir));
    painter = { backend: 'agy', maps: false };
    asked = [];
    svc = new ImageService(store, path.join(dir, 'images'), () => {}, new NoComfy(), {
      paintBackend: () => painter,
      cliPaint: async (r) => (asked.push(r), png(300, 300)),
    });
    store.images = svc;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a picture is painted by the chosen CLI, scaled to the size of its kind, and attached like any other', async () => {
    const id = run('create_node', { type: 'npc', title: 'Mira' }).id;
    run('generate_image', { nodeId: id, prompt: 'A young cartographer with ink-stained fingers', kind: 'portrait' });
    await idle(svc);
    expect(svc.jobs[0].status).toBe('done');
    expect(asked[0]).toMatchObject({ backend: 'agy', w: IMAGE_KINDS.portrait.w, h: IMAGE_KINDS.portrait.h });
    const file = store.state.nodes[id].images[0];
    expect(imageDimensions(fs.readFileSync(path.join(dir, 'images', file)))).toEqual({ w: IMAGE_KINDS.portrait.w, h: IMAGE_KINDS.portrait.h });
  });

  it('sketch → art: the reference picture goes to the CLI too', async () => {
    const id = run('create_node', { type: 'npc', title: 'Mira' }).id;
    const att = store.attachments.save('sketch.png', png(200, 260));
    run('generate_image', { nodeId: id, prompt: 'Mira, finished, in a leather coat', kind: 'portrait', reference: att.id, strength: 0.8 });
    await idle(svc);
    expect(asked[0].reference).toBeTruthy();
    expect(asked[0].referenceNote).toMatch(/sketch/);
  });

  it('maps stay with ComfyUI unless the GM allowed maps too; then render_map goes to the CLI in one pass from the plan', async () => {
    const m = run('create_map', { name: 'Hall', kind: 'battle', cols: 8, rows: 6 });
    expect(svc.paintBackend('map')).toBe('comfy');
    painter = { backend: 'codex', maps: true };
    const r = run('render_map', { mapId: m.mapId, prompt: 'a stone hall with banners' });
    expect(r.paintedBy).toBe('codex');
    await idle(svc);
    expect(asked[0]).toMatchObject({ backend: 'codex' });
    expect(asked[0].reference).toBeTruthy();
    expect(asked[0].referenceNote).toMatch(/PLAN/);
    expect(store.maps.get(m.mapId).renders).toHaveLength(1);
  });
});
