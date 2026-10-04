<script lang="ts">
  // A card "flies" between the pool and the canvas when the AI moves a node.
  import { NODE_TYPE_INFO } from '@pnp/shared';
  import { app, type Flyer } from '../lib/app.svelte';

  function fly(el: HTMLElement, f: Flyer) {
    const { from, to } = f;
    const sx = to.width / from.width;
    const sy = to.height / from.height;
    el.style.left = `${from.left}px`;
    el.style.top = `${from.top}px`;
    el.style.width = `${from.width}px`;
    el.style.height = `${from.height}px`;
    el.animate(
      [
        { transform: 'translate(0,0) scale(1,1)', opacity: 0.95, filter: 'blur(0)' },
        { transform: `translate(${(to.left - from.left) * 0.55}px, ${(to.top - from.top) * 0.55 - 36}px) scale(${1 + (sx - 1) * 0.55},${1 + (sy - 1) * 0.55})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${sx},${sy})`, opacity: 0.9, filter: 'blur(0.4px)' },
      ],
      { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
  }
</script>

{#each app.flyers as f (f.id)}
  {@const info = NODE_TYPE_INFO[f.node.type]}
  <div class="fl" use:fly={f} style="--tc:{info.color}">
    <span class="t">{info.icon} {info.label}</span>
    <b>{f.node.title}</b>
  </div>
{/each}

<style>
  .fl {
    position: fixed; z-index: 1000; pointer-events: none; transform-origin: top left; overflow: hidden;
    padding: 8px 12px; border-radius: var(--radius); background: var(--bg-3); border: 1px solid var(--tc);
    box-shadow: 0 0 34px -2px var(--tc), 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .t { display: block; font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--tc); }
  b { font-size: 14px; }
</style>
