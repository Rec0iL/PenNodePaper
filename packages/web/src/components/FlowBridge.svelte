<script lang="ts">
  // Lives inside <SvelteFlow> so it can use the flow hooks, and hands a small API
  // to the animation director (camera follow, screen<->flow coordinates).
  import { onDestroy, untrack } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import { app, registerFlowApi, takeIntro, takeRestore } from '../lib/app.svelte';

  const flow = useSvelteFlow();
  registerFlowApi({
    flowToScreen: (p) => flow.flowToScreenPosition(p),
    screenToFlow: (p) => flow.screenToFlowPosition(p),
    centerOn: (p, duration = 500) => flow.setCenter(p.x, p.y, { duration, zoom: Math.max(flow.getZoom(), 0.55) }),
    zoom: () => flow.getZoom(),
    getViewport: () => flow.getViewport(),
    setViewport: (v, duration = 400) => flow.setViewport(v, { duration }),
    fitBox: (b, duration = 450) => {
      const r = document.querySelector('.svelte-flow')?.getBoundingClientRect();
      const zoom = Math.min(1.6, Math.max(0.1, Math.min(((r?.width ?? 1000) * 0.86) / b.width, ((r?.height ?? 700) * 0.86) / b.height)));
      return flow.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration });
    },
    fit: () => flow.fitView({ duration: 400, padding: 0.15 }),
  });
  // A fresh start (or another campaign): first the whole canvas, then a slow glide to where it was left last time.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** the cards are drawn and measured (an empty canvas stops waiting after a while) */
  async function cardsDrawn() {
    for (let i = 0; i < 40; i++) {
      const cards = [...document.querySelectorAll<HTMLElement>('.svelte-flow__node')];
      if (cards.length && cards.every((c) => c.offsetWidth > 0)) break;
      await sleep(50);
    }
    await sleep(80);
  }
  $effect(() => {
    void app.introNonce;
    untrack(() => {
      const intro = takeIntro();
      if (!intro) return;
      void (async () => {
        await cardsDrawn();
        await flow.fitView({ duration: 0, padding: 0.08 });
        app.camReady = true;
        if (!intro.view) return;
        await sleep(350); // a moment to take in the whole canvas
        await flow.setViewport(intro.view, { duration: 1500 });
      })();
    });
  });

  // a canvas opened by its tab: back to where it was left (at once, so the old canvas' spot never shows), or the whole canvas
  $effect(() => {
    const id = app.canvasId;
    untrack(() => {
      const r = takeRestore(id);
      if (r === 'fit') setTimeout(() => void flow.fitView({ duration: 300, padding: 0.15 }), 120); // once its cards are measured
      else if (r) void flow.setViewport(r, { duration: 0 });
    });
  });
  onDestroy(() => registerFlowApi(null));
</script>
