import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_COMFY, MODEL_FAMILIES, detectFamily, guessFamilyFromName, missingComponents, recommendedSettings, workSize, type ComfyConfig } from '@pnp/shared';
import { Comfy, ComfyError } from '../src/comfy.js';
import { findModelsDir, isLocalUrl, readHeaderKeys, scanModels } from '../src/comfymodels.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-models-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A .safetensors file that is only its header (all the app ever reads): tensors with these names. */
function safetensors(file: string, names: string[]) {
  const header = Buffer.from(JSON.stringify({ __metadata__: { format: 'pt' }, ...Object.fromEntries(names.map((n) => [n, { dtype: 'F16', shape: [1], data_offsets: [0, 0] }])) }));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([len, header]));
}

const SD15 = ['cond_stage_model.transformer.text_model.embeddings.token_embedding.weight', 'model.diffusion_model.input_blocks.0.0.weight', 'first_stage_model.decoder.conv_in.weight'];
const SDXL = ['conditioner.embedders.0.transformer.text_model.final_layer_norm.weight', 'model.diffusion_model.input_blocks.0.0.weight', 'first_stage_model.decoder.conv_in.weight'];
const KREA = ['txtfusion.layers.0.weight', 'blocks.0.attn.weight'];
const ANIMA = ['blocks.0.adaln_modulation_cross_attn.1.weight', 'llm_adapter.0.weight'];

describe('model families', () => {
  it('are told apart by the tensor names, whatever the file is called', () => {
    expect(detectFamily(SD15, 'dndCoverArt_v10.safetensors')).toBe('sd15');
    expect(detectFamily(SDXL)).toBe('sdxl');
    expect(detectFamily(KREA)).toBe('krea2');
    expect(detectFamily(ANIMA)).toBe('anima');
    expect(detectFamily(['double_blocks.0.img_attn.qkv.weight', 'vae.decoder.conv_in.weight'])).toBe('flux_ckpt');
    expect(detectFamily(['double_blocks.0.img_attn.qkv.weight'])).toBe('flux_unet');
    expect(detectFamily(['double_blocks.0.img_attn.qkv.weight'], 'flux-kontext-dev.safetensors')).toBe('flux_kontext');
    expect(detectFamily(['model.diffusion_model.input_blocks.0.0.weight', 'model.diffusion_model.label_emb.0.0.weight'])).toBe('sdxl_unet');
    expect(detectFamily(['something.else'])).toBe('unknown');
  });

  it('are guessed from the name only where the name gives it away', () => {
    expect(guessFamilyFromName('Illustrious-XL-v1.safetensors', 'checkpoint')).toBe('sdxl');
    expect(guessFamilyFromName('ponyDiffusionV6XL.safetensors', 'checkpoint')).toBe('sdxl');
    expect(guessFamilyFromName('v1-5-pruned-emaonly.safetensors', 'checkpoint')).toBe('sd15');
    expect(guessFamilyFromName('krea2TurboOfficialComfy_krea2TurboInt8.safetensors', 'unet')).toBe('krea2');
    expect(guessFamilyFromName('dndCoverArt_v10.safetensors', 'checkpoint')).toBe('unknown');
  });

  it('bring the settings they were made for; distilled variants run short', () => {
    expect(recommendedSettings('sd15')).toMatchObject({ workflow: 'checkpoint', steps: 25, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras' });
    expect(recommendedSettings('sd15', 'dreamshaper_lcm.safetensors')).toMatchObject({ steps: 8, cfg: 2, sampler: 'dpmpp_sde' });
    expect(recommendedSettings('krea2')).toMatchObject({ workflow: 'diffusion', clipType: 'krea2', steps: 8, cfg: 1 });
    expect(recommendedSettings('wan')).toBeNull();
  });

  it('say which text encoder or VAE is missing, with where to get it', () => {
    const miss = missingComponents('krea2', { clip: [], vae: ['qwen_image_vae.safetensors'] });
    expect(miss.map((m) => m.file)).toEqual(['qwen3vl_4b_fp8_scaled.safetensors']);
    expect(miss[0].url).toMatch(/^https:\/\/huggingface\.co\//);
    expect(missingComponents('sd15', { clip: [], vae: [] })).toEqual([]); // the checkpoint has its own
  });

  it('SD 1.5 works at its own size and nothing else is scaled', () => {
    expect(workSize('sd15', 1344, 768)).toEqual({ w: 760, h: 432, scaled: true });
    expect(workSize('sd15', 832, 1216)).toMatchObject({ scaled: true });
    const s = workSize('sd15', 1024, 1024);
    expect(s.w % 8 + s.h % 8).toBe(0);
    expect(s.w * s.h).toBeLessThanOrEqual(0.33e6 * 1.05);
    expect(workSize('sd15', 512, 512)).toEqual({ w: 512, h: 512, scaled: false });
    for (const f of ['krea2', 'anima', 'sdxl', 'flux_ckpt', 'unknown', undefined]) expect(workSize(f, 1344, 768)).toEqual({ w: 1344, h: 768, scaled: false });
    expect(MODEL_FAMILIES.sd15.megapixels).toBe(0.33);
  });
});

describe('finding and reading the models', () => {
  it('reads the tensor names from a safetensors header and refuses anything else', () => {
    const f = path.join(dir, 'a.safetensors');
    safetensors(f, SD15);
    expect(readHeaderKeys(f).sort()).toEqual([...SD15].sort()); // __metadata__ is not a tensor
    fs.writeFileSync(path.join(dir, 'b.safetensors'), 'not a model at all, only text');
    expect(() => readHeaderKeys(path.join(dir, 'b.safetensors'))).toThrow();
    fs.writeFileSync(path.join(dir, 'c.safetensors'), '');
    expect(() => readHeaderKeys(path.join(dir, 'c.safetensors'))).toThrow();
  });

  it('finds the models folder: the one named first, then the usual places; none = ""', () => {
    const home = path.join(dir, 'home');
    const named = path.join(dir, 'named', 'models');
    fs.mkdirSync(path.join(named, 'checkpoints'), { recursive: true });
    expect(findModelsDir(named, home, {})).toBe(named);
    expect(findModelsDir('', home, {})).toBe('');
    fs.mkdirSync(path.join(home, 'ComfyUI', 'models', 'checkpoints'), { recursive: true });
    expect(findModelsDir('', home, {})).toBe(path.join(home, 'ComfyUI', 'models'));
    expect(findModelsDir(path.join(dir, 'typo'), home, {})).toBe(path.join(home, 'ComfyUI', 'models')); // a wrong name does not hide the usual place
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(path.join(ws, 'models', 'diffusion_models'), { recursive: true });
    fs.mkdirSync(path.join(home, '.config', 'comfy-cli'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'comfy-cli', 'config.ini'), `[DEFAULT]\ndefault_workspace = ${ws}\n`);
    expect(findModelsDir('', home, {})).toBe(path.join(ws, 'models')); // comfy-cli's workspace comes before a checkout in the home folder
  });

  it('only a ComfyUI on this computer has files to read', () => {
    expect(isLocalUrl('http://127.0.0.1:8188')).toBe(true);
    expect(isLocalUrl('http://localhost:8188/')).toBe(true);
    expect(isLocalUrl('http://192.168.0.20:8188')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });

  it('lists every model with its family: from the file when it can be read, from the name when not', () => {
    const m = path.join(dir, 'models');
    safetensors(path.join(m, 'checkpoints', 'dndCoverArt_v10.safetensors'), SD15);
    safetensors(path.join(m, 'checkpoints', 'whatever.safetensors'), SDXL);
    safetensors(path.join(m, 'diffusion_models', 'krea2Turbo.safetensors'), KREA);
    safetensors(path.join(m, 'checkpoints', 'animaOnly.safetensors'), ANIMA); // a bare diffusion model in the wrong folder
    safetensors(path.join(m, 'checkpoints', 'sub', 'mystery.safetensors'), ['nothing.recognisable']);
    safetensors(path.join(m, 'checkpoints', 'wan2.1.safetensors'), ['patch_embedding.weight', 'text_embedding.0.weight']);
    const lists = {
      unet: ['krea2Turbo.safetensors'],
      checkpoint: ['dndCoverArt_v10.safetensors', 'whatever.safetensors', 'animaOnly.safetensors', 'sub/mystery.safetensors', 'wan2.1.safetensors', 'Illustrious-XL.safetensors'],
    };
    const got = scanModels(m, lists);
    const by = Object.fromEntries(got.map((e) => [e.name, e]));

    expect(by['dndCoverArt_v10.safetensors']).toMatchObject({ family: 'sd15', loader: 'checkpoint', detected: 'header', usable: true });
    expect(by['dndCoverArt_v10.safetensors'].settings).toMatchObject({ workflow: 'checkpoint', cfg: 7 });
    expect(by['whatever.safetensors']).toMatchObject({ family: 'sdxl', loader: 'checkpoint', detected: 'header' });
    expect(by['krea2Turbo.safetensors']).toMatchObject({ family: 'krea2', loader: 'unet', detected: 'header' });
    expect(by['animaOnly.safetensors']).toMatchObject({ family: 'anima', loader: 'unet', needsLink: true });
    expect(by['sub/mystery.safetensors']).toMatchObject({ family: 'unknown', detected: 'none', usable: true, settings: null });
    expect(by['wan2.1.safetensors']).toMatchObject({ family: 'wan', usable: false, settings: null });
    expect(by['Illustrious-XL.safetensors']).toMatchObject({ family: 'sdxl', detected: 'name' }); // not on disk: the name says it
    expect(got.findIndex((e) => !e.usable)).toBeGreaterThan(got.findIndex((e) => e.name === 'whatever.safetensors')); // what cannot make pictures comes last
  });

  it('without the folder every model is guessed from its name', () => {
    const got = scanModels('', { unet: ['krea2Turbo.safetensors'], checkpoint: ['dndCoverArt_v10.safetensors', 'v1-5-pruned.safetensors'] });
    expect(got.map((e) => [e.name, e.family, e.detected])).toEqual([
      ['dndCoverArt_v10.safetensors', 'unknown', 'none'],
      ['krea2Turbo.safetensors', 'krea2', 'name'],
      ['v1-5-pruned.safetensors', 'sd15', 'name'],
    ]);
  });
});

const comfy = (over: Partial<ComfyConfig> = {}) => new Comfy(() => ({ ...DEFAULT_COMFY, ...over }));
const nodesOf = (wf: ReturnType<Comfy['buildWorkflow']>, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);

describe('the graphs', () => {
  it('Krea 2 (the default) is the graph it always was, node for node', () => {
    const wf = comfy().buildWorkflow('a tavern', 'text', 1344, 768, 7);
    expect(Object.keys(wf).sort()).toEqual(['1', '10', '11', '12', '13', '14', '15', '2', '3'].sort());
    expect(wf['1'].class_type).toBe('UNETLoader');
    expect(wf['13'].inputs.model).toEqual(['1', 0]);
    expect(wf['10'].inputs.clip).toEqual(['2', 0]);
    expect(wf['14']).toEqual({ class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['3', 0] } });
    expect(wf['12'].inputs).toMatchObject({ width: 1344, height: 768 });
  });

  it('a checkpoint takes model, text encoder and VAE from the one loader — no UNET / CLIP / VAE loaders to mismatch', () => {
    const wf = comfy({ workflow: 'checkpoint', family: 'sdxl', checkpoint: 'x.safetensors', steps: 28, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras' }).buildWorkflow('p', 'n', 1344, 768, 1);
    expect(nodesOf(wf, 'CheckpointLoaderSimple')).toHaveLength(1);
    for (const gone of ['UNETLoader', 'CLIPLoader', 'VAELoader']) expect(nodesOf(wf, gone)).toHaveLength(0);
    expect(wf['1'].inputs).toEqual({ ckpt_name: 'x.safetensors' });
    expect(wf['13'].inputs).toMatchObject({ model: ['1', 0], steps: 28, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras' });
    expect(wf['10'].inputs.clip).toEqual(['1', 1]);
    expect(wf['11'].inputs.clip).toEqual(['1', 1]);
    expect(wf['14'].inputs.vae).toEqual(['1', 2]);
    expect(wf['12'].inputs).toMatchObject({ width: 1344, height: 768 }); // SDXL copes with this size: no scaling
  });

  it('without a chosen checkpoint it says what to do, instead of sending ComfyUI an empty name', () => {
    expect(() => comfy({ workflow: 'checkpoint', checkpoint: '' }).buildWorkflow('p', 'n', 512, 512, 1)).toThrow(ComfyError);
    expect(() => comfy({ workflow: 'checkpoint', checkpoint: '' }).buildWorkflow('p', 'n', 512, 512, 1)).toThrow(/Image model/);
  });

  it('SD 1.5 samples at its own size and the picture comes out at the size asked for (node 14)', () => {
    const wf = comfy({ workflow: 'checkpoint', family: 'sd15', checkpoint: 'x.safetensors' }).buildWorkflow('p', 'n', 1344, 768, 1);
    expect(wf['12'].inputs).toMatchObject({ width: 760, height: 432 });
    expect(wf['9'].class_type).toBe('VAEDecode');
    expect(wf['14']).toEqual({ class_type: 'ImageScale', inputs: { image: ['9', 0], upscale_method: 'lanczos', width: 1344, height: 768, crop: 'disabled' } });
    expect(wf['15'].inputs.images).toEqual(['14', 0]);
    const small = comfy({ workflow: 'checkpoint', family: 'sd15', checkpoint: 'x.safetensors' }).buildWorkflow('p', 'n', 512, 512, 1);
    expect(small['14'].class_type).toBe('VAEDecode'); // already its size: nothing added
    expect(small['9']).toBeUndefined();
  });

  it('picture-to-picture reads the VAE from the same place, and an SD 1.5 plan is scaled to the model and back', () => {
    const base = { workflow: 'checkpoint' as const, checkpoint: 'x.safetensors' };
    const sdxl = comfy({ ...base, family: 'sdxl' }).buildImg2Img('p', 'n', 'plan.png', 3, 0.5);
    expect(sdxl['21'].inputs).toEqual({ pixels: ['20', 0], vae: ['1', 2] });
    expect(sdxl['13'].inputs).toMatchObject({ latent_image: ['21', 0], denoise: 0.5 });
    expect(sdxl['12']).toBeUndefined();
    expect(sdxl['14'].class_type).toBe('VAEDecode');

    const sd15 = comfy({ ...base, family: 'sd15' }).buildImg2Img('p', 'n', 'plan.png', 3, 0.5);
    expect(sd15['19']).toMatchObject({ class_type: 'ImageScaleToTotalPixels', inputs: { image: ['20', 0], megapixels: 0.33 } });
    expect(sd15['21'].inputs).toEqual({ pixels: ['19', 0], vae: ['1', 2] });
    expect(sd15['9'].class_type).toBe('VAEDecode');
    expect(sd15['16']).toEqual({ class_type: 'GetImageSize', inputs: { image: ['20', 0] } });
    expect(sd15['14'].inputs).toMatchObject({ image: ['9', 0], width: ['16', 0], height: ['16', 1] });
    expect(sd15['15'].inputs.images).toEqual(['14', 0]);

    const krea = comfy().buildImg2Img('p', 'n', 'plan.png', 3, 0.5);
    expect(krea['21'].inputs).toEqual({ pixels: ['20', 0], vae: ['3', 0] }); // the Krea 2 graph is untouched
    expect(krea['19']).toBeUndefined();
  });

  it('a refine keeps what is outside its mask at full size, also for a model that works smaller', () => {
    const wf = comfy({ workflow: 'checkpoint', family: 'sd15', checkpoint: 'x.safetensors' }).buildRefine('p', 'n', { image: 'a.png', original: 'o.png', mask: 'm.png' }, 1, 0.3);
    expect(wf['28'].inputs).toMatchObject({ source: ['14', 0], destination: ['50', 0], mask: ['24', 0], resize_source: false });
    expect(wf['14'].class_type).toBe('ImageScale'); // what is composited is back at the plan's size
  });

  it('an inpainted window is sampled at the model\'s size and scaled back to the window', () => {
    const crop = { x: 32, y: 48, w: 400, h: 300, tw: 768, th: 576 };
    const o = { image: 'a.png', sampleMask: 's.png', composeMask: 'c.png', crop };
    const sd15 = comfy({ workflow: 'checkpoint', family: 'sd15', checkpoint: 'x.safetensors' }).buildInpaint('p', 'n', o, 1);
    const w = sd15['22'].inputs as { width: number; height: number };
    expect(w.width * w.height).toBeLessThanOrEqual(0.33e6 * 1.05);
    expect(sd15['23'].inputs).toMatchObject({ vae: ['1', 2] });
    expect(sd15['26'].inputs).toMatchObject({ width: 400, height: 300 });
    const krea = comfy().buildInpaint('p', 'n', o, 1);
    expect(krea['22'].inputs).toMatchObject({ width: 768, height: 576 });
    expect(krea['23'].inputs).toMatchObject({ vae: ['3', 0] });
  });
});
