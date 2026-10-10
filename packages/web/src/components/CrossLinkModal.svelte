<script lang="ts">
  // Connect a node to a node on ANOTHER canvas (next act, side quest, flashback …). Opened from the node menu, the
  // inspector, or by dragging a connection onto a canvas tab.
  import { EDGE_KINDS, EDGE_KIND_INFO, NODE_TYPE_INFO, type EdgeKind } from '@pnp/shared';
  import { app, cmd } from '../lib/app.svelte';

  const req = $derived(app.crossLink);
  const from = $derived(req ? app.nodes[req.fromId] : undefined);
  const here = $derived(req ? app.graph.placements[req.fromId]?.canvas : undefined);

  let dir = $state<'out' | 'in'>('out');
  let canvas = $state('');
  let kind = $state<EdgeKind>('leads-to');
  let label = $state('');
  let query = $state('');
  let target = $state('');

  const others = $derived(app.graph.canvases.filter((c) => c.id !== here));
  $effect(() => {
    if (!req) return;
    dir = req.dir;
    kind = app.edgeKind;
    label = ''; query = ''; target = '';
    canvas = req.canvas && req.canvas !== here ? req.canvas : (app.graph.canvases.find((c) => c.id !== here)?.id ?? '');
  });

  const candidates = $derived(
    Object.entries(app.graph.placements)
      .filter(([id, p]) => p.canvas === canvas && id !== req?.fromId && app.nodes[id] && !app.nodes[id].trashed)
      .map(([id]) => app.nodes[id])
      .filter((n) => !query.trim() || n.title.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
  $effect(() => { if (target && !candidates.some((n) => n.id === target)) target = ''; });

  const close = () => (app.crossLink = null);
  async function connect() {
    if (!req || !target) return;
    const [a, b] = dir === 'out' ? [req.fromId, target] : [target, req.fromId];
    close();
    await cmd('link', { from: a, to: b, kind, label: label.trim() });
  }
</script>

<svelte:window onkeydown={(e) => req && e.key === 'Escape' && close()} />

{#if req && from}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="modal" data-tour="crosslink-modal" role="dialog" aria-label="Connect to another canvas">
      <header><b>Connect “{from.title}” to another canvas</b><span class="grow"></span><button class="btn ghost" onclick={close}>×</button></header>
      {#if !others.length}
        <p class="hint">There is only one canvas. Create another one first (the + next to the canvas tabs).</p>
      {:else}
        <div class="body">
          <div class="seg">
            <button class:on={dir === 'out'} onclick={() => (dir = 'out')} title="The story goes on from this node to the one you pick">this node → there</button>
            <button class:on={dir === 'in'} onclick={() => (dir = 'in')} title="The story arrives at this node from the one you pick">there → this node</button>
          </div>
          <div class="label">Canvas</div>
          <select class="field" bind:value={canvas}>
            {#each others as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
          <div class="label">Node on that canvas</div>
          <input class="field" placeholder="Search…" bind:value={query} />
          <div class="list">
            {#each candidates as n (n.id)}
              <button class="item" class:on={target === n.id} onclick={() => (target = n.id)} ondblclick={connect}>
                <span style="color:{NODE_TYPE_INFO[n.type].color}">{NODE_TYPE_INFO[n.type].icon}</span> {n.title}<span class="dim">{NODE_TYPE_INFO[n.type].label}</span>
              </button>
            {:else}
              <p class="hint">No nodes on this canvas{query ? ' match' : ' yet'}.</p>
            {/each}
          </div>
          <div class="two">
            <div>
              <div class="label">Kind</div>
              <select class="field" bind:value={kind}>{#each EDGE_KINDS as k}<option value={k}>{EDGE_KIND_INFO[k].label}</option>{/each}</select>
            </div>
            <div>
              <div class="label">Label <span class="dim">(optional)</span></div>
              <input class="field" bind:value={label} placeholder="e.g. if they take the ship" onkeydown={(e) => e.key === 'Enter' && connect()} />
            </div>
          </div>
        </div>
        <footer>
          <button class="btn ghost" onclick={close}>Cancel</button>
          <button class="btn primary" disabled={!target} onclick={connect}>Connect</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(5, 6, 9, 0.72); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(460px, 94vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .grow { flex: 1; }
  .body { padding: 8px 16px 12px; overflow: auto; display: grid; gap: 4px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 4px 0 6px; }
  .seg button { padding: 6px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--bg-3); color: var(--text-dim); font-size: 12px; }
  .seg button.on { color: var(--text); border-color: var(--accent); background: var(--bg-4); }
  .list { display: grid; gap: 2px; max-height: 210px; overflow: auto; margin-bottom: 6px; }
  .item { display: flex; gap: 8px; align-items: center; text-align: left; padding: 6px 8px; border-radius: 6px; background: var(--bg-3); border: 1px solid transparent; color: var(--text); font-size: 12.5px; }
  .item.on { border-color: var(--accent); background: var(--bg-4); }
  .item .dim { margin-left: auto; }
  .dim { color: var(--text-faint); font-size: 11px; }
  .hint { color: var(--text-faint); font-size: 12px; margin: 8px 16px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
