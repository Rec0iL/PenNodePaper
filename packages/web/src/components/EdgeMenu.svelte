<script lang="ts">
  import { EDGE_KIND_INFO, EDGE_KINDS, trailEdges, type CampaignState, type EdgeKind } from '@pnp/shared';
  import { app, cmd, closeMenus } from '../lib/app.svelte';

  const menu = $derived(app.edgeMenu);
  const edge = $derived(menu ? app.graph.edges.find((e) => e.id === menu.edgeId) : undefined);
  const info = $derived(edge ? EDGE_KIND_INFO[edge.kind] : undefined);
  const onTrail = $derived(edge ? trailEdges({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState).has(edge.id) : false);
  let kindsOpen = $state(false);
  $effect(() => { if (menu) kindsOpen = false; });

  async function act(name: string, args: Record<string, unknown>) {
    closeMenus();
    await cmd(name, args);
  }
  const pos = $derived(menu ? { left: Math.max(8, Math.min(menu.x, window.innerWidth - 308)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)) } : { left: 0, top: 0 });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeMenus()} />

{#if menu && edge && info}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ctx-scrim" onclick={closeMenus} oncontextmenu={(e) => { e.preventDefault(); closeMenus(); }}></div>
  <div class="cmenu" role="menu" style="left:{pos.left}px; top:{pos.top}px">
    <div class="ctx-head" style="color:{info.color}"><span>⟶</span> <b>{app.nodes[edge.from]?.title ?? '?'} → {app.nodes[edge.to]?.title ?? '?'}</b></div>
    <div class="ctx-hint"><b style="color:{info.color}">{info.label}</b> — {info.help}</div>
    <div class="ctx-sep"></div>
    {#if onTrail}
      <button class="ctx-item" onclick={() => act('relink', { edgeId: edge.id, noTrail: true })} title="The players did not really take this path">◌ Remove the played-path highlight</button>
    {:else if edge.noTrail}
      <button class="ctx-item" onclick={() => act('relink', { edgeId: edge.id, noTrail: false })}>● Highlight it when played again</button>
    {:else}
      <div class="ctx-hint">Not on the played path.</div>
    {/if}
    <button class="ctx-item" onclick={() => { app.selectedEdge = edge.id; app.tab = 'inspector'; closeMenus(); }}>✎ Edit label…</button>
    <button class="ctx-item" onclick={() => (kindsOpen = !kindsOpen)}>Kind <span class="sp"></span><span class="dim">{info.label}</span> <span class="dim">{kindsOpen ? '▾' : '▸'}</span></button>
    {#if kindsOpen}
      <div class="ctx-sub">
        {#each EDGE_KINDS as k}
          <button class="ctx-item" class:on={edge.kind === k} title={EDGE_KIND_INFO[k].help} onclick={() => act('relink', { edgeId: edge.id, kind: k as EdgeKind })}>
            <span style="color:{EDGE_KIND_INFO[k].color}">●</span> {EDGE_KIND_INFO[k].label}
          </button>
        {/each}
      </div>
    {/if}
    <button class="ctx-item" onclick={() => act('relink', { edgeId: edge.id, from: edge.to, to: edge.from })}>⇄ Reverse direction</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item danger" onclick={() => act('unlink', { edgeId: edge.id })}>Delete connection</button>
  </div>
{/if}
