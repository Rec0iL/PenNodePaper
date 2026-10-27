<script lang="ts">
  import { IMAGE_KINDS, type ImageKind, type StoryNode } from '@pnp/shared';
  import { activeJobs, app, attachToChat, cmd, jobAhead, say, sendChat } from '../lib/app.svelte';
  import { PICTURE_ACCEPT, importNodePicture } from '../lib/imageImport';

  let { node, mapRenders = [] }: { node: StoryNode; mapRenders?: string[] } = $props();

  let kind = $state<ImageKind>('square');
  let variants = $state(1);
  let prompt = $state('');
  let touched = $state(false);
  /** the node's own wording for its picture, saved with the node (fields.imagePrompt); until there is one the title and summary are the start */
  const defaultPrompt = $derived([node.title, node.summary].filter(Boolean).join('. '));
  const saved = $derived(typeof node.fields.imagePrompt === 'string' ? node.fields.imagePrompt : '');

  // sensible default kind + prompt per node type
  const defaultKind: Record<string, ImageKind> = { npc: 'portrait', location: 'scene', scene: 'scene', encounter: 'scene', event: 'scene', item: 'item', handout: 'handout', faction: 'banner' };
  /** picture to start from (img2img): a sketch that should become finished art, or a picture to redo; strength = how freely */
  let refFile = $state<string | null>(null);
  let strength = $state(0.75);
  let lastId = '';
  $effect(() => {
    if (node.id !== lastId) {
      lastId = node.id;
      touched = false;
      refFile = null;
      kind = defaultKind[node.type] ?? 'square';
    }
    if (!touched) prompt = saved || defaultPrompt;
  });
  /** keep the wording with the node: a prompt that is empty or just the default is not stored */
  async function keepPrompt() {
    const text = prompt.trim();
    const want = text && text !== defaultPrompt.trim() ? text : '';
    if (want === saved.trim()) return;
    await cmd('update_node', { id: node.id, fields: { imagePrompt: want || null } });
  }

  const jobs = $derived(app.jobs.filter((j) => j.nodeId === node.id && (j.status === 'queued' || j.status === 'running' || j.status === 'error')).slice(-6));
  const busy = $derived(jobs.some((j) => j.status === 'queued' || j.status === 'running'));

  let justQueued = $state(false);
  async function generate() {
    const before = activeJobs().length;
    void keepPrompt();
    const r = await cmd('generate_image', { nodeId: node.id, prompt, kind, variants, ...(refFile && node.images.includes(refFile) ? { reference: refFile, strength } : {}) });
    if (!r) return;
    touched = true;
    justQueued = true;
    setTimeout(() => (justQueued = false), 2200);
    say(before ? `Queued — ${before} image${before > 1 ? 's are' : ' is'} ahead of it` : 'Generating…', 'ok');
  }

  function askAi() {
    const ref = refFile && node.images.includes(refFile) ? refFile : null;
    void sendChat(
      ref
        ? `Look at the picture ${ref} of this node with view_image — it is the starting point (e.g. a sketch). Write a vivid image prompt for what it should become, finished (read the node with get_node and check get_image_style), then call generate_image for it with reference "${ref}", strength ${strength}, kind "${kind}" and ${variants} variant${variants > 1 ? 's' : ''}.`
        : `Write a vivid image prompt for this node (read it with get_node and check get_image_style), then call generate_image for it with kind "${kind}" and ${variants} variant${variants > 1 ? 's' : ''}.`,
      { nodeId: node.id },
    );
  }

  // the welcome tour types a prompt for this node
  $effect(() => {
    const f = app.fill;
    if (f && f.target === 'image' && f.nodeId === node.id) { prompt = f.text; touched = true; }
  });

  // pictures the GM already has
  let importing = $state(false);
  async function importFiles(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    if (!files.length) return;
    importing = true;
    let added = 0;
    for (const f of files) {
      const r = await importNodePicture(node.id, f);
      if (r.ok) added++;
      else say(`${f.name}: ${r.error}`);
    }
    importing = false;
    if (added) say(`${added} picture${added > 1 ? 's' : ''} added to “${node.title}”`, 'ok');
  }

  const cancel = () => fetch('/api/images/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
</script>

<div class="imgs">
  {#if node.images.length}
    <div class="grid">
      {#each node.images as f, i (f)}
        <div class="tile" class:cover={i === 0}>
          <button class="th" onclick={() => (app.lightbox = { nodeId: node.id, file: f })} title="View">
            <img src={`/api/images/${f}?w=320`} alt="" loading="lazy" decoding="async" />
          </button>
          {#if mapRenders.includes(f)}<span class="badge map">map</span>{:else if i === 0}<span class="badge">cover</span>{/if}
          <div class="hov">
            <button title="Start a new picture from this one (a sketch → finished art, or a better version)" class:on={refFile === f} onclick={() => (refFile = refFile === f ? null : f)}>✎</button>
            <button title="Show this picture to the AI (it goes along with your next chat message)" onclick={() => attachToChat(f)}>💬</button>
            {#if i !== 0}<button title="Use as cover" onclick={() => cmd('set_cover_image', { nodeId: node.id, file: f })}>★</button>{/if}
            <button title="Remove from node" onclick={() => cmd('remove_image', { nodeId: node.id, file: f })}>✕</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#each jobs as j (j.id)}
    <div class="job" class:err={j.status === 'error'}>
      {#if j.status === 'error'}
        <span class="msg">⚠ {j.error}</span>
      {:else}
        {@const ahead = jobAhead(j.id)}
        <span>
          {#if j.status === 'queued'}<b class="q">⏳ queued</b> · {ahead} ahead{:else}<b class="g">◌ generating {Math.round(j.progress * 100)}%</b>{/if}
          · {(j.kind === 'map' ? 'Map' : IMAGE_KINDS[j.kind].label)}
        </span>
        <div class="bar" class:wait={j.status === 'queued'}><i style="width:{j.status === 'queued' ? 100 : Math.round(j.progress * 100)}%"></i></div>
      {/if}
    </div>
  {/each}

  <div class="gen">
    <div class="r2">
      <select class="field" bind:value={kind} title={IMAGE_KINDS[kind].hint}>
        {#each Object.entries(IMAGE_KINDS) as [k, v]}<option value={k}>{v.label} ({v.w}×{v.h})</option>{/each}
      </select>
      <select class="field" bind:value={variants} title="Variants">
        {#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}
      </select>
    </div>
    {#if refFile && node.images.includes(refFile)}
      <div class="ref">
        <img src={`/api/images/${refFile}?w=96`} alt="" />
        <div class="rt">
          <b>Starting from this picture</b>
          <label class="dim" title="How far the new picture may move away from it: a rough sketch wants a lot, a finished picture a little">
            close <input type="range" min="0.3" max="0.9" step="0.05" bind:value={strength} /> free · {strength.toFixed(2)}
          </label>
        </div>
        <button class="lnk" title="Start from scratch again" onclick={() => (refFile = null)}>✕</button>
      </div>
    {/if}
    <textarea class="field" data-tour="img-prompt" rows="3" placeholder={refFile ? 'What should it become? (e.g. the elf from my sketch, in leather armour, at dusk)' : 'Describe the image…'} bind:value={prompt} oninput={() => (touched = true)} onchange={keepPrompt}></textarea>
    <div class="acts">
      <button class="btn primary" data-tour="img-generate" onclick={generate} disabled={prompt.trim().length < 8}>{justQueued ? '✓ Queued' : busy ? 'Add to queue' : 'Generate'}</button>
      <button class="btn" onclick={askAi} title="Let the AI write the prompt and generate">✦ AI writes it</button>
      <label class="btn" class:off={importing} title="Add pictures you already have (PNG, JPEG, WebP, GIF…) — they join the gallery like generated ones">{importing ? 'Importing…' : '⬆ Import'}<input type="file" accept={PICTURE_ACCEPT} multiple hidden disabled={importing} data-tour="img-import" onchange={importFiles} /></label>
      {#if busy}<button class="btn ghost" onclick={cancel}>stop</button>{/if}
      <button class="btn ghost gear" onclick={() => (app.settingsOpen = true)} title="ComfyUI & style settings">⚙</button>
    </div>
    <p class="hint">The campaign style is appended automatically.</p>
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
  .tile { position: relative; border-radius: var(--radius-s); overflow: hidden; border: 1px solid var(--line-2); aspect-ratio: 3 / 4; background: var(--bg); }
  .tile.cover { border-color: var(--accent); }
  .th { all: unset; display: block; width: 100%; height: 100%; cursor: zoom-in; }
  .th img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.25s; }
  .tile:hover img { transform: scale(1.05); }
  .badge { position: absolute; top: 4px; left: 4px; font-size: 9.5px; background: var(--accent); color: #0a0c11; padding: 0 6px; border-radius: 99px; font-weight: 600; }
  .hov { position: absolute; top: 4px; right: 4px; display: flex; gap: 3px; opacity: 0; transition: opacity 0.15s; }
  .tile:hover .hov { opacity: 1; }
  .hov button { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--line-2); background: rgba(10, 12, 17, 0.85); color: var(--text); padding: 0; }
  .hov button:hover, .hov button.on { border-color: var(--accent); }
  .tile:has(.hov button.on) .hov { opacity: 1; }
  .ref { display: flex; gap: 8px; align-items: center; padding: 6px; border: 1px solid var(--accent); border-radius: var(--radius-s); background: var(--bg-3); }
  .ref img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; }
  .ref .rt { flex: 1; display: grid; gap: 2px; font-size: 12px; }
  .ref label { display: flex; gap: 6px; align-items: center; font-size: 11px; }
  .ref input[type=range] { flex: 1; }
  .job { margin-bottom: 6px; font-size: 12px; color: var(--text-dim); }
  .job.err { color: var(--danger); background: #2a1518; border: 1px solid #5a2a30; padding: 6px 8px; border-radius: 6px; }
  .bar { height: 4px; background: var(--bg-4); border-radius: 99px; overflow: hidden; margin-top: 3px; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #b89cff); transition: width 0.4s; }
  .job .q { color: #ffcf70; font-weight: 600; }
  .job .g { color: var(--accent); font-weight: 600; }
  .bar.wait i { background: repeating-linear-gradient(45deg, #5a4a20 0 8px, #3a3014 8px 16px); background-size: 22px 22px; animation: pnp-wait 1s linear infinite; }
  @keyframes pnp-wait { to { background-position: 22px 0; } }
  .gen { display: grid; gap: 6px; }
  .r2 { display: grid; grid-template-columns: 1fr 70px; gap: 6px; }
  .acts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  label.btn { cursor: pointer; }
  label.btn.off { opacity: .6; pointer-events: none; }
  .gear { margin-left: auto; }
  .hint { margin: 0; color: var(--text-faint); font-size: 11px; }
.badge.map { background: #12301f; color: var(--ok); }
</style>
