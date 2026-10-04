<script lang="ts">
  import { NODE_TYPES, NODE_TYPE_INFO, type NodeType } from '@pnp/shared';
  import { app, cmd, closeMenus, selectNode } from '../lib/app.svelte';

  const menu = $derived(app.paneMenu);
  const groups: { id: 'story' | 'world' | 'helper'; label: string }[] = [
    { id: 'story', label: 'Story' }, { id: 'world', label: 'World' }, { id: 'helper', label: 'Helpers' },
  ];
  // player characters come from the VTT, enemies/NPCs are created like any node
  const types = (g: string) => NODE_TYPES.filter((t) => NODE_TYPE_INFO[t].group === g && t !== 'pc');

  async function add(t: NodeType) {
    if (!menu) return;
    const { fx, fy } = menu;
    closeMenus();
    const r = await cmd<{ id: string }>('create_node', { type: t, title: NODE_TYPE_INFO[t].label, place: 'canvas', x: fx, y: fy });
    if (r) selectNode(r.id);
  }
  async function addFrame() {
    if (!menu) return;
    const { fx, fy } = menu;
    closeMenus();
    const r = await cmd<{ id: string }>('create_frame', { title: 'New frame', x: fx, y: fy, w: 640, h: 380 });
    if (r) app.editingFrame = r.id;
  }
  const pos = $derived(menu ? { left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 420)) } : { left: 0, top: 0 });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeMenus()} />

{#if menu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ctx-scrim" onclick={closeMenus} oncontextmenu={(e) => { e.preventDefault(); closeMenus(); }}></div>
  <div class="cmenu pane" role="menu" style="left:{pos.left}px; top:{pos.top}px">
    <div class="ctx-head"><b>Add here</b></div>
    <button class="ctx-item" onclick={addFrame}><span style="color:#7aa2ff">▭</span> Frame — a labelled area (act, district…)</button>
    <div class="ctx-sep"></div>
    {#each groups as g}
      {#if types(g.id).length}
        <div class="ctx-sect">{g.label}</div>
        <div class="grid">
          {#each types(g.id) as t}
            <button class="ctx-item" onclick={() => add(t)}><span style="color:{NODE_TYPE_INFO[t].color}">{NODE_TYPE_INFO[t].icon}</span> {NODE_TYPE_INFO[t].label}</button>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .pane { width: 240px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; }
</style>
