<script lang="ts">
  import { IMAGE_KINDS, type ImageKind, type StoryNode } from '@pnp/shared';
  import { activeJobs, app, cmd, jobAhead, say, sendChat } from '../lib/app.svelte';

  let { node, mapRenders = [] }: { node: StoryNode; mapRenders?: string[] } = $props();

  let kind = $state<ImageKind>('square');
  let variants = $state(1);
  let prompt = $state('');
  let touched = $state(false);

  // sensible default kind + prompt per node type
  const defaultKind: Record<string, ImageKind> = { npc: 'portrait', location: 'scene', scene: 'scene', encounter: 'scene', event: 'scene', item: 'item', handout: 'handout', faction: 'banner' };
  let lastId = '';
  $effect(() => {
    if (node.id !== lastId) {
      lastId = node.id;
      touched = false;
      kind = defaultKind[node.type] ?? 'square';
    }
    if (!touched) prompt = [node.title, node.summary].filter(Boolean).join('. ');
  });

  const jobs = $derived(app.jobs.filter((j) => j.nodeId === node.id && (j.status === 'queued' || j.status === 'running' || j.status === 'error')).slice(-6));
  const busy = $derived(jobs.some((j) => j.status === 'queued' || j.status === 'running'));

  let justQueued = $state(false);
  async function generate() {
    const before = activeJobs().length;
    const r = await cmd('generate_image', { nodeId: node.id, prompt, kind, variants });
    if (!r) return;
    touched = true;
    justQueued = true;
    setTimeout(() => (justQueued = false), 2200);
    say(before ? `Queued — ${before} image${before > 1 ? 's are' : ' is'} ahead of it` : 'Generating…', 'ok');
  }

  function askAi() {
    void sendChat(
      `Write a vivid image prompt for this node (read it with get_node and check get_image_style), then call generate_image for it with kind "${kind}" and ${variants} variant${variants > 1 ? 's' : ''}.`,
      { nodeId: node.id },
    );
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
    <textarea class="field" rows="3" placeholder="Describe the image…" bind:value={prompt} oninput={() => (touched = true)}></textarea>
    <div class="acts">
      <button class="btn primary" onclick={generate} disabled={prompt.trim().length < 8}>{justQueued ? '✓ Queued' : busy ? 'Add to queue' : 'Generate'}</button>
      <button class="btn" onclick={askAi} title="Let the AI write the prompt and generate">✦ AI writes it</button>
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
  .hov button:hover { border-color: var(--accent); }
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
  .acts { display: flex; gap: 6px; align-items: center; }
  .gear { margin-left: auto; }
  .hint { margin: 0; color: var(--text-faint); font-size: 11px; }
.badge.map { background: #12301f; color: var(--ok); }
</style>
