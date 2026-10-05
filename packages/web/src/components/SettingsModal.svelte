<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ComfyConfig, MapPaintMode, StyleConfig } from '@pnp/shared';
  import { app, cmd, say } from '../lib/app.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface Opts { unet: string[]; clip: string[]; clipType: string[]; vae: string[]; samplers: string[]; schedulers: string[] }
  let comfy = $state<ComfyConfig | null>(null);
  let style = $state<StyleConfig | null>(null);
  let language = $state('de');
  let mapMode = $state<MapPaintMode>('quick');
  let alive = $state<boolean | null>(null);
  let opts = $state<Opts | null>(null);
  let loaded = $state(false);
  let baseline = ''; // what the server has: only real changes are saved
  const snapshot = () => JSON.stringify([comfy, style, language, mapMode]);
  let status = $state('');

  async function load() {
    alive = null;
    const j = await (await fetch('/api/settings')).json();
    comfy = j.comfy;
    style = j.style;
    language = j.language;
    mapMode = j.mapPaintMode === 'staged' ? 'staged' : 'quick';
    alive = j.alive;
    opts = j.options;
    baseline = snapshot();
    loaded = true;
  }
  onMount(load);

  // autosave (debounced)
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!loaded || !comfy || !style) return;
    const now = snapshot();
    if (now === baseline) return;
    clearTimeout(timer);
    status = 'Saving…';
    timer = setTimeout(async () => {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comfy, style, language, mapPaintMode: mapMode }) });
      if (r.ok) baseline = now;
      status = r.ok ? '✓ Saved automatically' : '⚠ save failed';
      if (!r.ok) say('Could not save settings');
    }, 600);
  });

  // ---- generate style from world books ------------------------------------------------------
  let worlds = $state(0);
  let genBusy = $state(false);
  let genErr = $state('');
  let before = $state<StyleConfig | null>(null);
  onMount(async () => {
    const lib = await (await fetch('/api/library')).json();
    worlds = lib.world.length;
  });
  async function generate() {
    if (!style) return;
    genBusy = true;
    genErr = '';
    try {
      const r = await fetch('/api/settings/generate-style', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend: app.backend, model: app.models[app.backend] || undefined }),
      });
      const j = await r.json();
      if (!j.ok) genErr = j.error ?? 'Generation failed';
      else {
        before = { ...style };
        style = j.style; // shown for review; autosave stores it like any other edit
      }
    } catch (e) {
      genErr = e instanceof Error ? e.message : String(e);
    }
    genBusy = false;
  }
  function revert() {
    if (before) style = before;
    before = null;
  }

  // the AI (set_image_style) may change the style while this window is open
  $effect(() => {
    const incoming = JSON.stringify(app.meta.style ?? {});
    untrack(() => {
      if (loaded && !genBusy && status.startsWith('✓')) void load();
    });
    void incoming;
  });

  // ---- VTT link ------------------------------------------------------------------------
  let bridge = $state<{ bridgeUrl: string; token: string } | null>(null);
  let showToken = $state(false);
  let exporting = $state(false);
  onMount(async () => {
    bridge = await (await fetch('/api/vtt')).json();
  });
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => say('Copied', 'ok'));
  async function exportBundle(format: 'kinetik-session' | 'upf') {
    exporting = true;
    const r = await cmd<{ file: string; url: string; handouts: number; scenes: number; characters: number }>('export_vtt_bundle', { format });
    exporting = false;
    if (!r) return;
    say(`Exported ${r.scenes} scene(s), ${r.handouts} handout(s) and ${r.characters} character(s)`, 'ok');
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.file;
    a.click();
  }

  const missing = (list: string[] | undefined, v: string) => !!list?.length && !list.includes(v);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-label="Settings">
    <header>
      <b>Settings</b>
      <span class="status">{status}</span>
      <span class="grow"></span>
      <button class="btn" onclick={onclose}>Done</button>
    </header>

    {#if comfy && style}
      <div class="body">
        <section>
          <h4>Campaign</h4>
          <div class="label">Language <span class="dim">— the AI writes campaign content in this language</span></div>
          <input class="field" bind:value={language} placeholder="de, en, …" />

          <h4>Image style <span class="dim">appended to every image prompt</span></h4>
          <div class="gen">
            <button class="btn primary" disabled={genBusy || worlds === 0} onclick={generate} title={worlds ? 'The AI reads your world books and drafts the style' : 'Write a world book first (Library)'}>
              {#if genBusy}<i class="spin"></i> Reading your world books…{:else}✦ Generate from world books{/if}
            </button>
            {#if before && !genBusy}<button class="btn ghost" onclick={revert} title="Restore the previous style">↶ revert</button>{/if}
          </div>
          <div class="dim">{worlds ? `Uses ${worlds} world book${worlds > 1 ? 's' : ''} with ${app.backend === 'agy' ? 'agy' : 'Claude'} (change in the AI tab). You can edit the result.` : 'No world book yet — write one in the Library and this will derive the look from it.'}</div>
          {#if genErr}<div class="err">⚠ {genErr}</div>{/if}
          <div class="label">Style</div>
          <textarea class="field" class:fresh={!!before} rows="4" bind:value={style.suffix}></textarea>
          <div class="label">Negative <span class="dim">(Krea 2 turbo ignores it at cfg 1)</span></div>
          <textarea class="field" class:fresh={!!before} rows="2" bind:value={style.negative}></textarea>
          <div class="label">Map style <span class="dim">(used instead of “Style” when painting maps)</span></div>
          <textarea class="field" class:fresh={!!before} rows="3" bind:value={style.mapSuffix}></textarea>
        </section>

        <section>
          <h4>ComfyUI <span class="dot" class:on={alive} class:off={alive === false}></span>
            <span class="dim">{alive === null ? 'checking…' : alive ? 'connected' : 'not reachable'}</span>
            <button class="btn ghost sm" onclick={load}>↻ test</button></h4>
          <div class="label">URL</div>
          <input class="field" bind:value={comfy.url} />

          {#each [['UNET (diffusion model)', 'unet', 'unet'], ['CLIP / text encoder', 'clip', 'clip'], ['CLIP type', 'clipType', 'clipType'], ['VAE', 'vae', 'vae']] as [label, key, optKey]}
            <div class="label">{label}</div>
            {#if opts?.[optKey as keyof Opts]?.length}
              <select class="field" class:bad={missing(opts[optKey as keyof Opts], comfy[key as 'unet'])} bind:value={comfy[key as 'unet']}>
                {#if missing(opts[optKey as keyof Opts], comfy[key as 'unet'])}<option value={comfy[key as 'unet']}>⚠ {comfy[key as 'unet']} (not installed)</option>{/if}
                {#each opts[optKey as keyof Opts] as o}<option value={o}>{o}</option>{/each}
              </select>
            {:else}
              <input class="field" bind:value={comfy[key as 'unet']} />
            {/if}
          {/each}

          <div class="r3">
            <div><div class="label">Steps</div><input class="field" type="number" min="1" max="100" bind:value={comfy.steps} /></div>
            <div><div class="label">CFG</div><input class="field" type="number" step="0.1" min="0" max="20" bind:value={comfy.cfg} /></div>
            <div><div class="label">Sampler</div>
              {#if opts?.samplers.length}<select class="field" bind:value={comfy.sampler}>{#each opts.samplers as o}<option>{o}</option>{/each}</select>
              {:else}<input class="field" bind:value={comfy.sampler} />{/if}</div>
            <div><div class="label">Scheduler</div>
              {#if opts?.schedulers.length}<select class="field" bind:value={comfy.scheduler}>{#each opts.schedulers as o}<option>{o}</option>{/each}</select>
              {:else}<input class="field" bind:value={comfy.scheduler} />{/if}</div>
          </div>
          <p class="hint">Defaults match your KINETIK setup: Krea 2 Turbo INT8, 8 steps, cfg 1. On a 16 GB card, start ComfyUI with <code>--reserve-vram 3</code>.</p>
        </section>

        <section class="wide">
          <h4>Map painting <span class="dim">how battle maps are painted — saved for this computer, all campaigns</span></h4>
          <div class="modes" role="radiogroup" aria-label="Map painting">
            <button class="mode" class:on={mapMode === 'quick'} role="radio" aria-checked={mapMode === 'quick'} onclick={() => (mapMode = 'quick')}>
              <b>Quick <span class="tag">1 step</span></b>
              <span>The plan, props included, is painted in a single pass.</span>
              <span class="pro">⏱ Roughly 1–2 minutes per picture on a 16 GB graphics card.</span>
              <span class="con">Less exact: furniture can drift, merge or vanish, and the model is held back by the flat colour blocks.</span>
            </button>
            <button class="mode" class:on={mapMode === 'staged'} role="radio" aria-checked={mapMode === 'staged'} onclick={() => (mapMode = 'staged')}>
              <b>Precise <span class="tag">2 steps</span></b>
              <span><i>Step 1</i> paints the empty place — more creative, and you accept it or paint it again. <i>Step 2</i> paints every prop group into exactly its spot (a row of tables becomes one long table) — you accept it or paint it again.</span>
              <span class="pro">Props land where the editor puts them and stand out clearly.</span>
              <span class="con">⏱ Takes a while: about 1½ minutes for the terrain plus about 40 seconds per prop group on a 16 GB card — a map with 15 prop groups takes around 12 minutes. A weaker graphics card needs proportionally longer.</span>
            </button>
          </div>
          <p class="hint">Both use the Krea 2 model you already have; precise needs no extra downloads. In the map editor, the Paint tab shows an estimate for the map in front of you (it gets accurate once ComfyUI has made an image on this computer), and you can stop a job at any time. Precise painting works on battle maps; region maps are always painted in one step.</p>
        </section>

        <section class="wide">
          <h4>VTT link <span class="dot" class:on={app.vtt?.connected}></span>
            <span class="dim">{app.vtt?.connected ? `${app.vtt.profile?.name} ${app.vtt.profile?.version} connected` : app.vtt?.profile ? `not connected — last seen: ${app.vtt.profile.name}` : 'no VTT has connected yet'}</span></h4>
          <p class="hint">Your tabletop software connects to PenNodePaper and announces what it can receive (handouts, scenes, NPCs, music). Enable the “PenNodePaper link” in the VTT’s GM page and give it this address and pairing token.</p>
          {#if bridge}
            <div class="two">
              <div><div class="label">Bridge address</div>
                <div class="copy"><code>{bridge.bridgeUrl}</code><button class="btn sm" onclick={() => copy(bridge!.bridgeUrl)}>copy</button></div></div>
              <div><div class="label">Pairing token</div>
                <div class="copy"><code>{showToken ? bridge.token : '••••••••••••••••••••'}</code>
                  <button class="btn sm" onclick={() => (showToken = !showToken)}>{showToken ? 'hide' : 'show'}</button>
                  <button class="btn sm" onclick={() => copy(bridge!.token)}>copy</button></div></div>
            </div>
          {/if}
          {#if app.vtt?.profile}
            <div class="label">What {app.vtt.profile.name} accepts</div>
            <div class="caps">
              {#each Object.keys(app.vtt.profile.push) as k}<span class="chip">{k.replace('_', ' ')}</span>{/each}
              {#if app.vtt.profile.characters}<span class="dim">character sheets: {app.vtt.profile.characters.roles.map((r) => r.label).join(', ')}{app.vtt.profile.push.character ? '' : ' (described, not receivable yet)'}</span>{/if}
            </div>
          {/if}
          <div class="label">Offline export <span class="dim">— no live connection needed</span></div>
          <div class="row">
            <button class="btn primary" disabled={exporting} onclick={() => exportBundle('kinetik-session')} title="A new KINETIK VTT session: maps and place pictures as scenes, handouts, enemies in the combat list, NPCs as map tokens">KINETIK session file</button>
            <button class="btn" disabled={exporting} onclick={() => exportBundle('upf')} title="Universal bundle other VTTs can import">Universal bundle (UPF)</button>
          </div>
          <p class="hint">The KINETIK session file creates a <b>new</b> session when loaded on the GM start screen (it replaces what is loaded there). Maps become scenes with grid size and token start positions already set.</p>
        </section>
      </div>
    {:else}
      <div class="loading">loading…</div>
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1600; background: rgba(5, 6, 9, 0.72); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(860px, 94vw); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .grow { flex: 1; }
  .status { font-size: 11.5px; color: var(--text-faint); }
  .body { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 6px 18px 20px; overflow: auto; }
  h4 { margin: 16px 0 2px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .dim { color: var(--text-faint); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11.5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
  .dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .dot.off { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
  .sm { padding: 0 8px; font-size: 11.5px; }
  .r3 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .bad { border-color: #e0c36a; }
  .hint { color: var(--text-faint); font-size: 11.5px; line-height: 1.5; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
  section.wide { grid-column: 1 / -1; border-top: 1px solid var(--line); margin-top: 6px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .copy { display: flex; gap: 6px; align-items: center; }
  .copy code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; background: var(--bg); border: 1px solid var(--line-2); border-radius: 6px; }
  .caps { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .row { display: flex; gap: 8px; }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 8px 0 6px; }
  .mode { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 6px; padding: 11px 13px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--bg); font-size: 12px; line-height: 1.45; color: var(--text-dim); }
  .mode:hover { border-color: var(--text-faint); }
  .mode.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
  .mode:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .mode b { font-size: 13px; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .mode .tag { font-weight: 500; font-size: 10.5px; padding: 1px 8px; border-radius: 99px; background: var(--bg-4); color: var(--text-dim); }
  .mode.on .tag { background: var(--accent); color: #0a0c11; }
  .mode i { color: var(--text); font-style: normal; font-weight: 600; }
  .pro { color: #8fd7a6; }
  .con { color: #e0c36a; }
  .gen { display: flex; gap: 8px; align-items: center; margin: 6px 0 4px; }
  .err { color: var(--danger); font-size: 12px; background: #2a1518; border: 1px solid #5a2a30; padding: 6px 8px; border-radius: 6px; margin-top: 4px; }
  .fresh { animation: pnp-diffglow 6s ease-out; border-color: var(--accent); }
  .spin { width: 11px; height: 11px; border: 2px solid rgba(10, 12, 17, 0.35); border-top-color: #0a0c11; border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite; vertical-align: -1px; margin-right: 4px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading { padding: 40px; text-align: center; color: var(--text-faint); }
  @media (max-width: 760px) { .body { grid-template-columns: 1fr; } .modes { grid-template-columns: 1fr; } }
</style>
