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
