<script lang="ts">
  // Lives inside <SvelteFlow> so it can use the flow hooks, and hands a small API
  // to the animation director (camera follow, screen<->flow coordinates).
  import { onDestroy } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import { app, registerFlowApi } from '../lib/app.svelte';

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
  let seen = app.fitNonce;
  $effect(() => {
    if (app.fitNonce === seen) return;
    seen = app.fitNonce;
    setTimeout(() => void flow.fitView({ duration: 400, padding: 0.15 }), 120);
  });
  onDestroy(() => registerFlowApi(null));
</script>
