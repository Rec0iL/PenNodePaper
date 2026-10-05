import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { DEFAULT_COMFY, type ComfyConfig, type Crop } from '@pnp/shared';

// ---------------------------------------------------------------------------
// ComfyUI client (REST + progress websocket). Ported from KINETIK's
// tools/rulebook-pdf/rpdf/comfy.py: same Krea 2 graph, same error style.
// ---------------------------------------------------------------------------

export class ComfyError extends Error {}

export interface ComfyOptions {
  unet: string[];
  clip: string[];
  clipType: string[];
  vae: string[];
  samplers: string[];
  schedulers: string[];
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export class Comfy {
  constructor(private cfg: () => ComfyConfig = () => DEFAULT_COMFY) {}

  private get base() {
    return this.cfg().url.replace(/\/+$/, '');
  }

  private async json<T>(path: string, init?: RequestInit, timeout = 15000): Promise<T> {
    const res = await fetch(this.base + path, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeout) });
    if (!res.ok) throw new ComfyError(`ComfyUI ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 600)}`);
    return (await res.json()) as T;
  }

  async alive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/system_stats`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Installed models / samplers, as ComfyUI reports them. */
  async options(): Promise<ComfyOptions> {
    const get = async (node: string, input: string): Promise<string[]> => {
      try {
        const j = await this.json<Record<string, { input: { required: Record<string, [string[]]> } }>>(`/object_info/${node}`);
        const v = j[node]?.input?.required?.[input]?.[0];
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };
    const [unet, clip, clipType, vae, samplers, schedulers] = await Promise.all([
      get('UNETLoader', 'unet_name'),
      get('CLIPLoader', 'clip_name'),
      get('CLIPLoader', 'type'),
      get('VAELoader', 'vae_name'),
      get('KSampler', 'sampler_name'),
      get('KSampler', 'scheduler'),
    ]);
    return { unet, clip, clipType, vae, samplers, schedulers };
  }

  /** Krea 2 turbo ("anima") graph: UNET + CLIP + VAE loaders -> KSampler -> SaveImage. */
  buildWorkflow(prompt: string, negative: string, w: number, h: number, seed: number): Workflow {
    const c = this.cfg();
    return {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: c.unet, weight_dtype: 'default' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: c.clip, type: c.clipType, device: 'default' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
      '10': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
      '11': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negative } },
      '12': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
      '13': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0], positive: ['10', 0], negative: ['11', 0], latent_image: ['12', 0],
          seed, steps: c.steps, cfg: c.cfg, sampler_name: c.sampler, scheduler: c.scheduler, denoise: 1.0,
        },
      },
      '14': { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['3', 0] } },
      '15': { class_type: 'SaveImage', inputs: { filename_prefix: 'pennodepaper', images: ['14', 0] } },
    };
  }

  /** Upload an image into ComfyUI's input folder (for LoadImage). Returns the stored file name. */
  async uploadImage(bytes: Buffer, name: string): Promise<string> {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name);
    fd.append('overwrite', 'true');
    const res = await fetch(`${this.base}/upload/image`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new ComfyError(`Could not upload the control image: HTTP ${res.status}`);
    return ((await res.json()) as { name: string }).name;
  }

  /** Same Krea 2 graph, but starting from an image (layout -> painted map). denoise 0..1: low = faithful, high = creative. */
  buildImg2Img(prompt: string, negative: string, image: string, seed: number, denoise: number): Workflow {
    const wf = this.buildWorkflow(prompt, negative, 64, 64, seed);
    delete wf['12'];
    wf['20'] = { class_type: 'LoadImage', inputs: { image } };
    wf['21'] = { class_type: 'VAEEncode', inputs: { pixels: ['20', 0], vae: ['3', 0] } };
    wf['13'].inputs.latent_image = ['21', 0];
    wf['13'].inputs.denoise = denoise;
    return wf;
  }

  /**
   * Inpaint one window of an image with the same Krea 2 graph (no inpainting model needed): crop the window,
   * scale it to the model's working size, sample only inside the noise mask, scale back and blend into the
   * untouched original through a soft mask, so nothing outside the mask changes by a single pixel.
   * `image` / `sampleMask` / `composeMask` are names of files uploaded to ComfyUI (the masks use the red channel).
   */
  buildInpaint(prompt: string, negative: string, o: { image: string; sampleMask: string; composeMask: string; crop: Crop }, seed: number, denoise = 1): Workflow {
    const c = o.crop;
    const wf = this.buildWorkflow(prompt, negative, 64, 64, seed);
    delete wf['12'];
    wf['20'] = { class_type: 'LoadImage', inputs: { image: o.image } };
    wf['21'] = { class_type: 'ImageCrop', inputs: { image: ['20', 0], width: c.w, height: c.h, x: c.x, y: c.y } };
    wf['22'] = { class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width: c.tw, height: c.th, crop: 'disabled' } };
    wf['23'] = { class_type: 'VAEEncode', inputs: { pixels: ['22', 0], vae: ['3', 0] } };
    wf['24'] = { class_type: 'LoadImageMask', inputs: { image: o.sampleMask, channel: 'red' } };
    wf['25'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['23', 0], mask: ['24', 0] } };
    wf['13'].inputs.latent_image = ['25', 0];
    wf['13'].inputs.denoise = denoise;
    wf['26'] = { class_type: 'ImageScale', inputs: { image: ['14', 0], upscale_method: 'lanczos', width: c.w, height: c.h, crop: 'disabled' } };
    wf['27'] = { class_type: 'LoadImageMask', inputs: { image: o.composeMask, channel: 'red' } };
    wf['28'] = { class_type: 'ImageCompositeMasked', inputs: { destination: ['20', 0], source: ['26', 0], x: c.x, y: c.y, resize_source: false, mask: ['27', 0] } };
    wf['15'].inputs.images = ['28', 0];
    return wf;
  }

  async interrupt() {
    try {
      await fetch(`${this.base}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    } catch { /* best effort */ }
  }

  /** Queue a workflow, report progress (0..1), and return the first image's bytes. */
  async generate(
    workflow: Workflow,
    opts: { onProgress?: (p: number) => void; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ bytes: Buffer; filename: string }> {
    if (!(await this.alive())) throw new ComfyError(`ComfyUI is not reachable at ${this.base} — start it first.`);
    const clientId = randomUUID();
    let res: Response;
    try {
      res = await fetch(`${this.base}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new ComfyError(`ComfyUI rejected the request: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) throw new ComfyError(`ComfyUI refuses the workflow: ${(await res.text()).slice(0, 800)}`);
    const promptId = ((await res.json()) as { prompt_id: string }).prompt_id;

    // progress over the websocket (best effort; completion is detected by polling /history)
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(String(data)) as { type: string; data: { value?: number; max?: number; prompt_id?: string } };
          if (m.type === 'progress' && m.data.max && (!m.data.prompt_id || m.data.prompt_id === promptId)) opts.onProgress?.(Math.min(0.99, m.data.value! / m.data.max));
        } catch { /* ignore */ }
      });
      ws.on('error', () => {});
    } catch { /* no progress, still works */ }

    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    try {
      for (;;) {
        if (opts.signal?.aborted) {
          await this.interrupt();
          throw new ComfyError('Cancelled.');
        }
        if (Date.now() > deadline) throw new ComfyError('ComfyUI timed out.');
        await new Promise((r) => setTimeout(r, 1200));
        const hist = await this.json<Record<string, { status?: { status_str?: string; messages?: [string, Record<string, unknown>][] }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>>(`/history/${promptId}`);
        const h = hist[promptId];
        if (!h) continue;
        if (h.status?.status_str === 'error') {
          const err = h.status.messages?.find((m) => m[0] === 'execution_error')?.[1];
          throw new ComfyError(`ComfyUI error: ${String(err?.exception_message ?? 'execution failed').slice(0, 600)}`);
        }
        const img = Object.values(h.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
        if (!img) {
          if (h.status?.status_str === 'success') throw new ComfyError('ComfyUI finished without producing an image.');
          continue;
        }
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
        const view = await fetch(`${this.base}/view?${q}`, { signal: AbortSignal.timeout(60000) });
        if (!view.ok) throw new ComfyError(`Could not fetch the image: HTTP ${view.status}`);
        opts.onProgress?.(1);
        return { bytes: Buffer.from(await view.arrayBuffer()), filename: img.filename };
      }
    } finally {
      ws?.close();
    }
  }
}
