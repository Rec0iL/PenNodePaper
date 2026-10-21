import type { ComfyConfig } from './index.js';

// ---------------------------------------------------------------------------
// Which settings an image model needs. Every model family is made to run with one kind of graph, its own text encoder
// and VAE, and its own steps / CFG / sampler — the wrong combination fails with errors like "mat1 and mat2 shapes
// cannot be multiplied" (an SD 1.5 model fed with a Krea 2 text encoder). The family is read from the model file's
// safetensors header (tensor names, so it does not depend on the file name — see server/src/comfymodels.ts), or picked
// by hand when ComfyUI's models folder is not reachable. Ported from illuminator (rpdf/models.py).
// ---------------------------------------------------------------------------

/** diffusion: UNET + CLIP + VAE loaded separately (Krea 2, Anima). checkpoint: everything in one file (SD 1.5, SDXL, Illustrious, Pony, Flux checkpoints). */
export type ComfyWorkflow = 'diffusion' | 'checkpoint';

export type FamilyKey = 'krea2' | 'anima' | 'sdxl' | 'sd15' | 'flux_ckpt' | 'flux_kontext' | 'flux_unet' | 'wan' | 'sdxl_unet' | 'other' | 'unknown';

/** What choosing a model sets. */
export type ModelSettings = Pick<ComfyConfig, 'workflow' | 'steps' | 'cfg' | 'sampler' | 'scheduler'> & Partial<Pick<ComfyConfig, 'clip' | 'clipType' | 'vae'>>;

export interface ModelFamily {
  key: FamilyKey;
  label: string;
  /** can make a picture from a prompt with this app's graphs (default true) */
  usable?: boolean;
  note?: string;
  settings?: ModelSettings;
  /** overrides for distilled / turbo / lightning variants (steps, cfg, sampler …) */
  fast?: Partial<ModelSettings>;
  /** component file -> where to get it, shown when the text encoder or VAE is not installed */
  downloads?: Record<string, string>;
  /**
   * The picture size (megapixels) the model was trained at. Asked for more, it paints the picture twice (doubled faces, bodies),
   * so it works at about this size and the result is scaled up to what was asked for. Absent = the model copes with the sizes the app uses.
   */
  megapixels?: number;
}

const HF = 'https://huggingface.co';

export const MODEL_FAMILIES: Record<FamilyKey, ModelFamily> = {
  krea2: {
    key: 'krea2', label: 'Krea 2', note: 'Turbo model: few steps, CFG 1 (the negative prompt only works with “Negative prompt works” on).',
    settings: { workflow: 'diffusion', clip: 'qwen3vl_4b_fp8_scaled.safetensors', clipType: 'krea2', vae: 'qwen_image_vae.safetensors', steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' },
    downloads: {
      'qwen3vl_4b_fp8_scaled.safetensors': `${HF}/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors`,
      'qwen_image_vae.safetensors': `${HF}/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors`,
    },
  },
  anima: {
    key: 'anima', label: 'Anima',
    settings: { workflow: 'diffusion', clip: 'qwen_3_06b_base.safetensors', clipType: 'stable_diffusion', vae: 'qwen_image_vae.safetensors', steps: 28, cfg: 4, sampler: 'euler', scheduler: 'simple' },
    downloads: {
      'qwen_3_06b_base.safetensors': `${HF}/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors`,
      'qwen_image_vae.safetensors': `${HF}/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors`,
    },
  },
  sdxl: {
    key: 'sdxl', label: 'SDXL / Illustrious / Pony', note: 'One checkpoint file: text encoders and VAE are inside it.',
    settings: { workflow: 'checkpoint', steps: 28, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras' },
    fast: { steps: 8, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras' },
  },
  sd15: {
    key: 'sd15', label: 'SD 1.5', note: 'Trained at about 512 px: pictures are made small and scaled up to the size asked for.',
    settings: { workflow: 'checkpoint', steps: 25, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras' },
    fast: { steps: 8, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras' },
    megapixels: 0.33,
  },
  flux_ckpt: {
    key: 'flux_ckpt', label: 'Flux (checkpoint with encoders and VAE)', note: 'CFG 1: the negative prompt has no effect.',
    settings: { workflow: 'checkpoint', steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple' },
    fast: { steps: 4 },
  },
  flux_kontext: { key: 'flux_kontext', label: 'Flux Kontext', usable: false, note: 'An image-editing model: it needs an input picture, not a prompt alone.' },
  flux_unet: { key: 'flux_unet', label: 'Flux (diffusion model only)', usable: false, note: 'Needs two text encoders and a guidance node: use a Flux checkpoint with everything in one file instead.' },
  wan: { key: 'wan', label: 'Wan (video)', usable: false, note: 'A video model: not for single pictures.' },
  sdxl_unet: { key: 'sdxl_unet', label: 'SDXL (UNet only)', usable: false, note: 'No text encoder or VAE in the file: use the complete checkpoint.' },
  other: { key: 'other', label: 'not an image model', usable: false, note: 'Not a text-to-image model (detection, pose, segmentation …).' },
  unknown: { key: 'unknown', label: 'unknown', usable: true, note: 'Kind not recognised: pick the model type yourself.' },
};

/** The families to choose from by hand ("Model type"): the ones that bring settings. */
export const PICKABLE_FAMILIES: FamilyKey[] = ['krea2', 'anima', 'sdxl', 'sd15', 'flux_ckpt'];

/** Distilled / turbo variants run with far fewer steps and a low CFG. */
export const FAST_HINT = /lightning|turbo|hyper|dmd|lcm|schnell|flash/i;

/** The family from the tensor names in a safetensors header (what they are called does not depend on the file name). */
export function detectFamily(keys: readonly string[], filename = ''): FamilyKey {
  const has = (s: string) => keys.some((k) => k.includes(s));
  const tops = new Set(keys.map((k) => k.split('.')[0]));
  if (has('txtfusion')) return 'krea2';
  if (has('adaln_modulation_cross_attn') || has('llm_adapter')) return 'anima';
  if (has('double_blocks')) {
    if (/kontext/i.test(filename)) return 'flux_kontext';
    return tops.has('vae') || tops.has('text_encoders') ? 'flux_ckpt' : 'flux_unet';
  }
  if (has('conditioner.embedders')) return 'sdxl';
  if (has('cond_stage_model') && has('input_blocks')) return 'sd15';
  if (has('patch_embedding') && has('text_embedding')) return 'wan';
  if (has('input_blocks') && has('label_emb')) return 'sdxl_unet';
  if (tops.has('detector') || tops.has('tracker') || (tops.has('first_stage_model') && !has('cond_stage_model'))) return 'other';
  return 'unknown';
}

/**
 * A guess from the file name, for when the file itself cannot be read (ComfyUI runs elsewhere, or its models folder is not
 * known). Only what names really give away; anything else stays `unknown` and is picked by hand.
 */
export function guessFamilyFromName(name: string, loader: 'unet' | 'checkpoint'): FamilyKey {
  if (/krea[-_ ]?2/i.test(name)) return 'krea2';
  if (/anima/i.test(name)) return 'anima';
  if (/flux/i.test(name)) return /kontext/i.test(name) ? 'flux_kontext' : loader === 'checkpoint' ? 'flux_ckpt' : 'flux_unet';
  if (/sdxl|illustrious|pony|noobai|[-_ ]xl\b|xl[-_ ]/i.test(name)) return loader === 'checkpoint' ? 'sdxl' : 'sdxl_unet';
  if (/sd[-_ ]?1[-_.]?5|v1-5|sd15/i.test(name)) return 'sd15';
  return 'unknown';
}

/** The settings a model of this family is meant to run with (null for families that cannot make pictures). */
export function recommendedSettings(family: FamilyKey, modelName = ''): ModelSettings | null {
  const f = MODEL_FAMILIES[family];
  if (!f?.settings) return null;
  return { ...f.settings, ...(FAST_HINT.test(modelName) ? f.fast : {}) };
}

/** The size (megapixels) a family works at, when it is smaller than what the app asks for; undefined = no scaling. */
export const familyMegapixels = (family: string | undefined): number | undefined => MODEL_FAMILIES[family as FamilyKey]?.megapixels;

/**
 * The size the model works at for a picture of w×h: the same proportions at the family's native area, multiples of 8
 * (the latent grid). Unchanged when the family has no limit or the picture is not (much) bigger than it.
 */
export function workSize(family: string | undefined, w: number, h: number): { w: number; h: number; scaled: boolean } {
  const mp = familyMegapixels(family);
  if (!mp || (w * h) / 1e6 <= mp * 1.15) return { w, h, scaled: false };
  const k = Math.sqrt((mp * 1e6) / (w * h));
  const snap = (n: number) => Math.max(64, Math.round((n * k) / 8) * 8);
  return { w: snap(w), h: snap(h), scaled: true };
}

/** Text encoder / VAE files a family needs that ComfyUI does not have (with where to get them). */
export function missingComponents(family: FamilyKey, installed: { clip: readonly string[]; vae: readonly string[] }): { file: string; url?: string }[] {
  const s = MODEL_FAMILIES[family]?.settings;
  if (!s) return [];
  const out: { file: string; url?: string }[] = [];
  if (s.clip && !installed.clip.includes(s.clip)) out.push({ file: s.clip, url: MODEL_FAMILIES[family].downloads?.[s.clip] });
  if (s.vae && !installed.vae.includes(s.vae)) out.push({ file: s.vae, url: MODEL_FAMILIES[family].downloads?.[s.vae] });
  return out;
}
