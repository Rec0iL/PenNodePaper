<script lang="ts">
  import { onMount } from 'svelte';
  import { app, cmd, say } from '../lib/app.svelte';

  let { nodeId, file, onclose }: { nodeId: string; file: string; onclose: () => void } = $props();
  interface Pass { phase?: string; positive: string; negative: string; denoise?: number; negativeOn?: boolean }
  let meta = $state<{ prompt: string; seed: number; kind: string; w: number; h: number; passes?: Pass[] } | null>(null);
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
        {#if meta.passes?.length}
          <details class="passes">
            <summary>How it was painted · {meta.passes.length} step{meta.passes.length > 1 ? 's' : ''}</summary>
            {#each meta.passes as p, i (i)}
              <div class="pass">
                <b>{i + 1}. {p.phase ?? 'Painting'}</b>{#if p.denoise !== undefined} <span class="dim">· strength {p.denoise}</span>{/if}{#if p.negativeOn} <span class="dim">· negative prompt on</span>{/if}
                <div class="pl">Told to paint</div><p>{p.positive}</p>
                <div class="pl">Told to avoid{p.negativeOn ? '' : ' (not in effect: the negative prompt was off, CFG 1)'}</div><p>{p.negative}</p>
              </div>
            {/each}
          </details>
        {/if}
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
  .passes { margin-top: 8px; font-size: 12px; }
  .passes summary { cursor: pointer; color: var(--text-dim); }
  .passes .pass { margin: 8px 0; padding-top: 6px; border-top: 1px solid var(--line-2); }
  .passes .pl { margin-top: 4px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); }
  .passes p { margin: 2px 0 0; line-height: 1.45; color: var(--text-dim); max-height: 140px; overflow: auto; white-space: pre-wrap; }
</style>
