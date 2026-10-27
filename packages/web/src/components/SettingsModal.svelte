<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { MODEL_FAMILIES, PICKABLE_FAMILIES, actorName, missingComponents, recommendedSettings, type ComfyConfig, type FamilyKey, type MapPaintMode, type ModelSettings, type PaintBackend, type StyleConfig } from '@pnp/shared';
  import { app, chatMeta, cmd, say } from '../lib/app.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface Opts { unet: string[]; checkpoint: string[]; clip: string[]; clipType: string[]; vae: string[]; samplers: string[]; schedulers: string[] }
  /** one image model ComfyUI has, with the family it belongs to (server/src/comfymodels.ts) */
  interface Model { name: string; loader: 'unet' | 'checkpoint'; family: FamilyKey; detected: 'header' | 'name' | 'none'; usable: boolean; fast: boolean; settings: ModelSettings | null; needsLink?: boolean }
  let comfy = $state<ComfyConfig | null>(null);
  let style = $state<StyleConfig | null>(null);
  let language = $state('de');
  let mapMode = $state<MapPaintMode>('quick');
  let painter = $state<PaintBackend>({ backend: 'comfy', maps: false });
  let painters = $state<{ agy: boolean; codex: boolean } | null>(null);
  let alive = $state<boolean | null>(null);
  let practice = $state(false);
  let opts = $state<Opts | null>(null);
  let models = $state<Model[]>([]);
  let modelsDir = $state(''); // the folder the models were read from ('' = none found)
  let modelsLocal = $state(true); // ComfyUI runs on this computer, so its files can be read
  let modelsDirInput = $state(''); // the folder the GM named (saved for this computer)
  let loaded = $state(false);
  let baseline = ''; // what the server has: only real changes are saved
  const snapshot = () => JSON.stringify([comfy, style, language, mapMode, modelsDirInput, painter]);
  let status = $state('');
  let lastDir = ''; // the models folder the list was last read with

  async function load() {
    alive = null;
    const j = await (await fetch('/api/settings')).json();
    comfy = j.comfy;
    style = j.style;
    language = j.language;
    mapMode = j.mapPaintMode === 'staged' ? 'staged' : 'quick';
    painter = j.paintBackend ?? { backend: 'comfy', maps: false };
    void chatMeta().then((m) => (painters = { agy: m.agy.installed, codex: m.codex.installed })).catch(() => {});
    alive = j.alive;
    practice = !!j.practice;
    opts = j.options;
    modelsDirInput = j.comfyModelsDir ?? '';
    lastDir = modelsDirInput;
    baseline = snapshot();
    loaded = true;
    void loadModels();
  }
  async function loadModels() {
    try {
      const m = (await (await fetch('/api/comfy/models')).json()) as { modelsDir: string; local?: boolean; models: Model[] };
      models = m.models;
      modelsDir = m.modelsDir;
      modelsLocal = m.local !== false;
    } catch { models = []; }
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
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comfy, style, language, mapPaintMode: mapMode, comfyModelsDir: modelsDirInput, paintBackend: painter }) });
      if (r.ok) baseline = now;
      if (r.ok && modelsDirInput !== lastDir) { lastDir = modelsDirInput; void loadModels(); } // a new models folder: read the models again
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

  // ---- LAN access ------------------------------------------------------------------------
  let lan = $state<{ enabled: boolean; port: number; urls: string[]; code?: string; local: boolean } | null>(null);
  onMount(async () => {
    lan = await (await fetch('/api/lan')).json();
  });
  async function newCode() {
    if (!confirm('Make a new access code? Every device that is logged in now has to enter the new one.')) return;
    const r = (await (await fetch('/api/lan/new-code', { method: 'POST' })).json()) as { ok: boolean; code?: string; error?: string };
    if (!r.ok) return say(r.error ?? 'Could not make a new code');
    if (lan) lan.code = r.code;
    say('New access code', 'ok');
  }

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

  // ---- image models: picking one (or its type) sets what it needs ---------------------------
  const modelKey = (m: { loader: string; name: string }) => `${m.loader}|${m.name}`;
  const currentName = $derived(comfy ? (comfy.workflow === 'checkpoint' ? comfy.checkpoint : comfy.unet) : '');
  const currentKey = $derived(comfy ? modelKey({ loader: comfy.workflow === 'checkpoint' ? 'checkpoint' : 'unet', name: currentName }) : '');
  const family = $derived(MODEL_FAMILIES[(comfy?.family as FamilyKey) in MODEL_FAMILIES ? (comfy!.family as FamilyKey) : 'unknown']);
  const absent = $derived(comfy && opts && family.key !== 'unknown' ? missingComponents(family.key, { clip: opts.clip, vae: opts.vae }) : []);

  /** The family's own graph, text encoder, VAE, steps, CFG and sampler (a sampler / scheduler ComfyUI does not have is left as it is). */
  function applyFamily(key: string, name = currentName) {
    if (!comfy) return;
    comfy.family = key;
    const s = recommendedSettings(key as FamilyKey, name);
    if (!s) return;
    comfy.workflow = s.workflow;
    comfy.steps = s.steps;
    comfy.cfg = s.cfg;
    if (!opts?.samplers.length || opts.samplers.includes(s.sampler)) comfy.sampler = s.sampler;
    if (!opts?.schedulers.length || opts.schedulers.includes(s.scheduler)) comfy.scheduler = s.scheduler;
    if (s.clip) comfy.clip = s.clip;
    if (s.clipType) comfy.clipType = s.clipType;
    if (s.vae) comfy.vae = s.vae;
  }
  function pickModel(key: string) {
    const m = models.find((x) => modelKey(x) === key);
    if (!m || !comfy) return;
    if (m.loader === 'checkpoint') comfy.checkpoint = m.name; else comfy.unet = m.name;
    comfy.workflow = m.loader === 'checkpoint' ? 'checkpoint' : 'diffusion';
    applyFamily(m.family, m.name);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" data-tour="settings-modal" role="dialog" aria-label="Settings">
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
          <div class="dim">{worlds ? `Uses ${worlds} world book${worlds > 1 ? 's' : ''} with ${actorName(app.backend)} (change in the AI tab). You can edit the result.` : 'No world book yet — write one in the Library and this will derive the look from it.'}</div>
          {#if genErr}<div class="err">⚠ {genErr}</div>{/if}
          <div class="label">Style</div>
          <textarea class="field" class:fresh={!!before} rows="4" bind:value={style.suffix}></textarea>
          <div class="label">Negative <span class="dim">(only works with “Negative prompt works” on in the ComfyUI settings: turbo models ignore it at CFG 1)</span></div>
          <textarea class="field" class:fresh={!!before} rows="2" bind:value={style.negative}></textarea>
          <div class="label">Map style <span class="dim">(used instead of “Style” when painting maps)</span></div>
          <textarea class="field" class:fresh={!!before} rows="3" bind:value={style.mapSuffix}></textarea>
          <div class="dim">Only how maps <b>look</b>: surfaces, materials, brush, palette. The camera angle and the kind of map (battle or region) are set on each map, in its Paint tab — camera wording written here is ignored.</div>
        </section>

        <section>
          <h4>ComfyUI <span class="dot" class:on={alive} class:off={alive === false}></span>
            <span class="dim">{alive === null ? 'checking…' : alive ? 'connected' : 'not reachable'}</span>
            <button class="btn ghost sm" onclick={load}>↻ test</button></h4>
          <div class="label">URL</div>
          <input class="field" bind:value={comfy.url} />

          <div class="label">Image model <span class="dim">— pick one and its graph, text encoder, VAE and sampler are set for you</span></div>
          {#if models.length}
            <select class="field" data-tour="settings-model" value={currentKey} onchange={(e) => pickModel(e.currentTarget.value)}>
              {#if !models.some((m) => modelKey(m) === currentKey)}<option value={currentKey}>{currentName || '—'} (current)</option>{/if}
              {#each models as m}
                <option value={modelKey(m)} disabled={!m.usable}>{m.name} — {MODEL_FAMILIES[m.family].label}{m.fast ? ' · fast' : ''}{m.detected === 'name' ? ' (guessed from its name)' : ''}{m.needsLink ? ' ⚠ not in diffusion_models' : ''}</option>
              {/each}
            </select>
          {:else if alive}
            <p class="hint">ComfyUI lists no image models yet.</p>
          {:else}
            <p class="hint">Connect to ComfyUI to list its models; until then the settings below are used as they are.</p>
          {/if}
          <div class="label">Model type <span class="dim">— what the model was made for; set by itself when it can be told from the file</span></div>
          <select class="field" value={family.key} onchange={(e) => applyFamily(e.currentTarget.value)}>
            {#each [...PICKABLE_FAMILIES, ...(PICKABLE_FAMILIES.includes(family.key) ? [] : [family.key])] as k}<option value={k}>{MODEL_FAMILIES[k].label}</option>{/each}
          </select>
          {#if family.note}<p class="hint">{family.note}</p>{/if}
          {#each models.filter((m) => modelKey(m) === currentKey && m.needsLink) as _}<p class="err">⚠ This model only lies in <code>checkpoints/</code>, where ComfyUI's diffusion-model loader does not look. Copy or link it into <code>models/diffusion_models/</code>.</p>{/each}
          {#each absent as a}<p class="err">⚠ Not installed in ComfyUI: <code>{a.file}</code>{#if a.url} — <a href={a.url} target="_blank" rel="noreferrer">download</a> (text encoders go in <code>models/text_encoders/</code>, VAEs in <code>models/vae/</code>), then ↻ test{/if}</p>{/each}
          <button class="btn ghost sm" disabled={!recommendedSettings(family.key, currentName)} onclick={() => applyFamily(family.key)} title="Set this model type's own graph, text encoder, VAE, steps, CFG and sampler again">↺ Recommended values</button>

          {#if comfy.workflow === 'checkpoint'}
            <div class="label">Checkpoint <span class="dim">— one file with the model, text encoder and VAE inside</span></div>
            {#if opts?.checkpoint?.length}
              <select class="field" class:bad={missing(opts.checkpoint, comfy.checkpoint)} bind:value={comfy.checkpoint}>
                {#if missing(opts.checkpoint, comfy.checkpoint)}<option value={comfy.checkpoint}>⚠ {comfy.checkpoint || 'none chosen'} (not installed)</option>{/if}
                {#each opts.checkpoint as o}<option value={o}>{o}</option>{/each}
              </select>
            {:else}
              <input class="field" bind:value={comfy.checkpoint} />
            {/if}
          {:else}
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
          {/if}

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
          <label class="chk" title="Turbo models run at CFG 1, where ComfyUI ignores the negative prompt completely. With this on, pictures are made with the CFG below instead, so “no furniture / no buildings / no text” is obeyed. It makes every step about twice the work. A CFG you set above 1 yourself is kept as it is.">
            <input type="checkbox" bind:checked={comfy.negative} /> Negative prompt works <span class="dim">— pictures use the CFG below instead of 1; about twice the time</span>
          </label>
          {#if comfy.negative}
            <div class="r3">
              <div><div class="label">CFG with negative prompt</div><input class="field" type="number" step="0.1" min="1.1" max="3" bind:value={comfy.negativeCfg} title="2 clears unwanted objects well; 1.5 only half-way; from about 3 turbo models burn out (white bands)" /></div>
            </div>
            {#if comfy.cfg > 1}<p class="hint">Your CFG above is more than 1, so it is used as it is.</p>{:else if comfy.negativeCfg > 2.5}<p class="err">⚠ Above about 2.5 turbo models start to burn out (white bands in the picture).</p>{/if}
          {/if}
          {#if modelsLocal}
            <div class="label">ComfyUI models folder <span class="dim">— optional: lets PenNodePaper tell models apart by what is inside the files, not by their names{modelsDir ? ` (reading ${modelsDir})` : ' (none found by itself)'}</span></div>
            <input class="field" bind:value={modelsDirInput} placeholder={modelsDir || 'e.g. C:\\ComfyUI\\models or ~/ComfyUI/models'} />
          {/if}
          {#if comfy.family === 'krea2'}<p class="hint">Defaults match your KINETIK setup: Krea 2 Turbo INT8, 8 steps, cfg 1. On a 16 GB card, start ComfyUI with <code>--reserve-vram 3</code>.</p>{/if}
          <p class="hint">Map painting was tuned with Krea 2: other models paint maps and pictures too, but the strengths it uses (how far a map may be repainted) were chosen for Krea 2.</p>
        </section>

        {#if practice}
          <section class="wide practice"><p class="hint"><b>Practice campaign.</b> ComfyUI is simulated here: the pictures and maps are played back, and the Map painting choice below only applies while the tour runs. {alive ? 'A real ComfyUI answers on this address.' : 'No real ComfyUI answers on this address — everything except pictures works without one.'}</p></section>
        {/if}
        <section class="wide">
          <h4>Image generation <span class="dim">who paints the pictures — saved for this computer, all campaigns</span></h4>
          <div class="modes three" role="radiogroup" aria-label="Image generation">
            <button class="mode" class:on={painter.backend === 'comfy'} role="radio" aria-checked={painter.backend === 'comfy'} onclick={() => (painter = { ...painter, backend: 'comfy' })}>
              <b>ComfyUI <span class="tag">local</span></b>
              <span>Your own graphics card with the model chosen above. Everything works with it: pictures, sketch → art, both ways of map painting.</span>
            </button>
            <button class="mode" class:on={painter.backend === 'agy'} role="radio" aria-checked={painter.backend === 'agy'} disabled={painters?.agy === false} onclick={() => (painter = { ...painter, backend: 'agy' })}>
              <b>agy <span class="tag">experimental</span></b>
              <span>The image tool of the Antigravity CLI paints instead (uses your Google account's quota).{painters?.agy === false ? ' — agy is not installed.' : ''}</span>
            </button>
            <button class="mode" class:on={painter.backend === 'codex'} role="radio" aria-checked={painter.backend === 'codex'} disabled={painters?.codex === false} onclick={() => (painter = { ...painter, backend: 'codex' })}>
              <b>Codex <span class="tag">experimental</span></b>
              <span>The image tool of the Codex CLI paints instead (uses your OpenAI plan).{painters?.codex === false ? ' — Codex is not installed.' : ''}</span>
            </button>
          </div>
          {#if painter.backend !== 'comfy'}
            <label class="chk"><input type="checkbox" checked={painter.maps} onchange={(e) => (painter = { ...painter, maps: e.currentTarget.checked })} /> Also battle maps and region maps <span class="dim">(experimental too: the map is painted in one go from its plan; the precise two-step way and repainting single groups keep using ComfyUI)</span></label>
            <p class="hint">Experimental. agy paints with its own image subagent (like Illuminator's agy engine): about half a minute per picture, sketch → art works too; when its picture quota is used up the job says when it comes back. Codex is untested (not installed here): the app asks it to paint one picture and save it. If a job fails, it says what the CLI answered — switch back to ComfyUI then. Claude cannot paint pictures, so it is not offered.</p>
          {/if}
        </section>

        <section class="wide">
          <h4>Map painting <span class="dim">how maps are painted — saved for this computer, all campaigns</span></h4>
          <div class="modes" data-tour="settings-map-modes" role="radiogroup" aria-label="Map painting">
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
          <p class="hint">Both use the Krea 2 model you already have; precise needs no extra downloads. In the map editor, the Paint tab shows an estimate for the map in front of you (it gets accurate once ComfyUI has made an image on this computer), and you can stop a job at any time. Precise painting works on battle maps (terrain, then props) and on region maps (land with rivers and roads, then structures); both end with an optional pass that blends the objects into the picture.</p>
        </section>

        <section class="wide">
          <h4>LAN access <span class="dot" class:on={lan?.enabled}></span>
            <span class="dim">{lan?.enabled ? (lan.local ? 'on — other devices on your network can use this' : 'on — you are using it from another device') : 'off — only this computer'}</span></h4>
          {#if lan?.enabled && lan.local}
            <p class="hint">On the other device (laptop, tablet) open one of these addresses and type the access code once. The server, your files and the AI stay on this computer; the other device controls all of it.</p>
            {#each lan.urls as u (u)}<div class="copy"><code>{u}</code><button class="btn sm" onclick={() => copy(u)}>copy</button></div>{/each}
            <div class="copy" style="margin-top:4px"><span class="dim">access code</span> <code>{lan.code}</code><button class="btn sm" onclick={() => copy(lan!.code ?? '')}>copy</button><button class="btn sm" onclick={newCode} title="Log every other device out and use a new code">new code</button></div>
            <p class="hint">Anyone on this network who knows the code can do everything you can here, so share it only with yourself and keep to a network you trust.</p>
          {:else if lan?.enabled}
            <p class="hint">You are connected over the network. The access code is shown on the computer that runs PenNodePaper.</p>
          {:else}
            <p class="hint">To work from another device (say, the laptop in the garden), start PenNodePaper in LAN mode: right-click its start-menu entry → <i>Start in LAN mode</i>, or use the tray icon. Then come back here for the address and the access code.</p>
          {/if}
        </section>

        <section class="wide" data-tour="settings-vtt">
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
  .chk { display: flex; gap: 6px; align-items: baseline; font-size: 12.5px; margin-top: 8px; color: var(--text-dim); }
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
  .modes.three { grid-template-columns: 1fr 1fr 1fr; }
  .mode:disabled { opacity: .5; cursor: not-allowed; }
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
  @media (max-width: 760px) { .body { grid-template-columns: 1fr; } .modes, .modes.three { grid-template-columns: 1fr; } }
</style>
