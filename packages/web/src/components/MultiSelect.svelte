<script lang="ts">
  // Several nodes selected on the canvas: set them all active / here / done at once.
  import { NODE_TYPE_INFO, STATUS_CHOICES, groupsOf, type CampaignState } from '@pnp/shared';
  import { app, cmd, focusNode, hereMany, setStatusMany } from '../lib/app.svelte';

  const ids = $derived(app.multi.filter((id) => app.nodes[id]));
  const campaign = $derived({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState);
  let group = $state('');
  const del = () => cmd('batch', { ops: ids.map((id) => ({ command: 'delete_node', args: { id } })), label: `Deleted ${ids.length} nodes` });
</script>

<div class="insp">
  <div class="head"><span class="icon">▦</span><div class="id"><b>{ids.length} nodes selected</b><code>Shift-click or Shift-drag to select more</code></div></div>
  <div class="list">
    {#each ids as id (id)}
      <button class="it" style="--c:{NODE_TYPE_INFO[app.nodes[id].type].color}" onclick={() => focusNode(id)}>{NODE_TYPE_INFO[app.nodes[id].type].icon} {app.nodes[id].title}<span class="dim">{app.nodes[id].status}</span></button>
    {/each}
  </div>
  <div class="label">At the table</div>
  <div class="box">
    <input class="field" list="multi-groups" bind:value={group} placeholder="Group (default: party)" />
    <datalist id="multi-groups">{#each groupsOf(campaign) as g}<option value={g}></option>{/each}</datalist>
    <button class="btn primary" onclick={() => hereMany(ids, group.trim() || undefined)} title="The players are at all of these at once — e.g. in the tavern while the bell is ringing">▶ Players are here at all {ids.length}</button>
    <div class="seg" role="group" aria-label="Status of all">
      {#each STATUS_CHOICES as c}
        <button class="segb" title={c.help} onclick={() => setStatusMany(ids, c.id)}>{c.icon} {c.label}</button>
      {/each}
    </div>
    <p class="dim small">“Active” alone only marks them as in play; “Players are here” also puts the players there.</p>
  </div>
  <button class="btn danger" onclick={del}>🗑 Delete {ids.length} nodes</button>
</div>

<style>
  .insp { padding: 12px 14px; display: grid; gap: 10px; align-content: start; }
  .head { display: flex; gap: 10px; align-items: center; }
  .icon { font-size: 18px; color: var(--accent); }
  .id { display: grid; }
  .id code { font-size: 10.5px; color: var(--text-faint); }
  .list { display: grid; gap: 2px; max-height: 220px; overflow: auto; }
  .it { display: flex; gap: 8px; align-items: center; text-align: left; background: var(--bg-3); border: 0; border-left: 3px solid var(--c); border-radius: 6px; padding: 5px 8px; color: var(--text); font-size: 12px; }
  .it .dim { margin-left: auto; }
  .dim { color: var(--text-faint); font-size: 11px; }
  .box { display: grid; gap: 8px; }
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 2px; background: var(--bg-3); border-radius: var(--radius-s); }
  .segb { background: transparent; border: 0; border-radius: 6px; padding: 5px 2px; font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .segb:hover { color: var(--text); background: var(--bg-4); }
  p.small { margin: 0; line-height: 1.4; }
</style>
