import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_COMFY, effectiveCfg } from '@pnp/shared';
import { Comfy } from '../src/comfy.js';
import { ImageService } from '../src/images.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

// Turbo models run at CFG 1, where ComfyUI ignores the negative prompt completely (measured on a real ComfyUI: CFG 1 leaves the
// furniture in, CFG 2 clears the room, CFG 3 burns the picture). So the negative prompt gets its own CFG.

describe('the negative prompt works: a CFG above 1 while it is on', () => {
  const cfg = (over = {}) => ({ ...DEFAULT_COMFY, ...over });

  it('the turbo CFG 1 becomes the negative prompt\'s CFG; a CFG you set above 1 yourself stays', () => {
    expect(DEFAULT_COMFY.cfg).toBe(1);
    expect(effectiveCfg(cfg())).toBe(2);
    expect(effectiveCfg(cfg({ negativeCfg: 1.6 }))).toBe(1.6);
    expect(effectiveCfg(cfg({ negative: false }))).toBe(1); // switched off: as before
    expect(effectiveCfg(cfg({ cfg: 4 }))).toBe(4);
    expect(effectiveCfg(cfg({ cfg: 4, negative: false }))).toBe(4);
    // nonsense is held to what a turbo model can take
    expect(effectiveCfg(cfg({ negativeCfg: 9 }))).toBe(3);
    expect(effectiveCfg(cfg({ negativeCfg: 0 }))).toBe(1.1);
  });

  it('every workflow the app builds (pictures, img2img, inpaint, refine) samples with it, and carries the negative text', () => {
    const comfy = new Comfy(() => cfg());
    for (const wf of [
      comfy.buildWorkflow('a map', 'no furniture', 64, 64, 1),
      comfy.buildImg2Img('a map', 'no furniture', 'x.png', 1, 0.7),
      comfy.buildRefine('a map', 'no furniture', { image: 'a.png', mask: 'm.png' }, 1, 0.3),
    ]) {
      expect(wf['13'].inputs.cfg).toBe(2);
      expect(wf['13'].inputs.negative).toEqual(['11', 0]);
      expect(wf['11'].inputs.text).toBe('no furniture');
    }
    expect(new Comfy(() => cfg({ negative: false })).buildWorkflow('p', 'n', 64, 64, 1)['13'].inputs.cfg).toBe(1);
  });

  describe('time and record', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-neg-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('a step takes longer with it: the estimate says so until it has been measured on this computer', () => {
      const store = new Store(new Persistence(dir));
      const svc = new ImageService(store, path.join(dir, 'images'), () => undefined, new Comfy(() => cfg()));
      const on = svc.estimateSeconds(1);
      store.state.meta.comfy = { negative: false };
      const off = svc.estimateSeconds(1);
      expect(on.measured).toBe(false);
      expect(on.seconds / off.seconds).toBeCloseTo(1.5, 1);
    });
  });
});
