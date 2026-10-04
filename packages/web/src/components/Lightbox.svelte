<script lang="ts">
  import { onMount } from 'svelte';
  import { app, cmd, say } from '../lib/app.svelte';

  let { nodeId, file, onclose }: { nodeId: string; file: string; onclose: () => void } = $props();
  let meta = $state<{ prompt: string; seed: number; kind: string; w: number; h: number } | null>(null);
  const node = $derived(app.nodes[nodeId]);
  const isCover = $derived(node?.images[0] === file);

  onMount(async () => {
    meta = ((await (await fetch('/api/images-meta')).json()) as Record<string, typeof meta>)[file] ?? null;
  });
  const copy = () => meta && navigator.clipboard.writeText(meta.prompt).then(() => say('Prompt copied'));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="box">
    <img src={`/api/images/${file}`} alt="" />
    <aside>
      <div class="label">{node?.title ?? nodeId}</div>
      {#if meta}
        <p class="prompt">{meta.prompt}</p>
        <div class="dim">{meta.kind} · {meta.w}×{meta.h} · seed {meta.seed}</div>
      {:else}<p class="dim">No generation info (imported image).</p>{/if}
      <div class="acts">
        {#if meta}<button class="btn" onclick={copy}>Copy prompt</button>{/if}
        {#if node && !isCover}<button class="btn" onclick={() => cmd('set_cover_image', { nodeId, file })}>★ Use as cover</button>{/if}
        {#if node}<button class="btn danger" onclick={() => { void cmd('remove_image', { nodeId, file }); onclose(); }}>Remove</button>{/if}
        <button class="btn ghost" onclick={onclose}>Close</button>
      </div>
    </aside>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1600; background: rgba(5, 6, 9, 0.85); backdrop-filter: blur(6px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .box { display: flex; gap: 18px; max-width: 94vw; max-height: 92vh; }
  img { max-height: 92vh; max-width: 70vw; object-fit: contain; border-radius: 12px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7); }
  aside { width: 280px; align-self: flex-end; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 12px 14px; }
  .prompt { font-size: 12.5px; line-height: 1.55; color: var(--text); margin: 4px 0 8px; max-height: 40vh; overflow: auto; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
</style>
