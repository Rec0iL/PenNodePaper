<script lang="ts">
  import { VISITABLE_TYPES, STATUS_CHOICES as STATUS_CHOICES_SHARED, NODE_TYPE_INFO, DEFAULT_GROUP, groupColor, groupsOf, visitsOf, type CampaignState, type StoryNode } from '@pnp/shared';
  import { app, cmd, hereMany, openCrossLink, selectNode, setStatusMany } from '../lib/app.svelte';

  const menu = $derived(app.nodeMenu);
  /** Right-click on a node that belongs to a multi-selection acts on the whole selection. */
  const many = $derived(menu && app.multi.length > 1 && app.multi.includes(menu.nodeId) ? app.multi.filter((id) => app.nodes[id]) : []);
  const node = $derived(menu ? app.nodes[menu.nodeId] : undefined);
  const placed = $derived(!!(menu && app.graph.placements[menu.nodeId]));
  const campaign = $derived({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState);

  const pcs = $derived(Object.values(app.nodes).filter((n) => n.type === 'pc' && !n.trashed && n.fields.present !== false).sort((a, b) => a.title.localeCompare(b.title)));
  const groupOf = (p: StoryNode) => (typeof p.fields.group === 'string' && p.fields.group ? p.fields.group : DEFAULT_GROUP);
  /** Where each part of the party currently is. */
  function whereIs(group: string): string {
    const here = Object.values(app.nodes).filter((n) => !n.trashed && visitsOf(n).some((v) => v.here && v.group === group));
    return here.length ? here.map((n) => n.title).join(', ') : 'nowhere yet';
  }
  const fragments = $derived([...new Set(pcs.map(groupOf))]);

  const STATUS_CHOICES = STATUS_CHOICES_SHARED;
  let statusOpen = $state(false);
  async function setStatus(status: string) {
    if (!node) return;
    const id = node.id;
    const ids = many;
    close();
    if (ids.length) await setStatusMany(ids, status);
    else await cmd('set_status', { nodeId: id, status });
  }
  async function frameThem() {
    const ids = many.filter((id) => app.graph.placements[id]);
    close();
    if (!ids.length) return;
    const r = await cmd<{ id: string }>('create_frame', { title: 'New frame', nodeIds: ids });
    if (r) app.editingFrame = r.id;
  }
  async function hereAll() {
    const ids = many;
    const g = customGroup.trim() || undefined;
    close();
    await hereMany(ids, g);
  }

  let picked = $state<string[]>([]);
  let customGroup = $state('');
  let ref: HTMLDivElement | undefined = $state();
  $effect(() => { if (menu) { picked = []; customGroup = ''; statusOpen = false; } });

  const close = () => (app.nodeMenu = null);
  const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const pickGroup = (g: string) => {
    const ids = pcs.filter((p) => groupOf(p) === g).map((p) => p.id);
    const all = ids.every((i) => picked.includes(i));
    picked = all ? picked.filter((i) => !ids.includes(i)) : [...new Set([...picked, ...ids])];
  };
  const hereNow = (p: StoryNode) => node && visitsOf(node).some((v) => v.here && v.group === groupOf(p));

  async function movePlayers(chars: string[]) {
    if (!node || !chars.length) return;
    const id = node.id;
    close();
    await cmd('move_players', { characters: chars, nodeId: id });
  }
  async function playedBy(group: string | undefined, status: 'active' | 'done' | 'skipped' = 'active') {
    if (!node) return;
    const id = node.id;
    close();
    await cmd('mark_played', { nodeId: id, status, ...(group ? { group } : {}) });
  }
  async function act(name: string, args: Record<string, unknown>) { close(); await cmd(name, args); }

  // keep the menu inside the viewport
  const pos = $derived.by(() => {
    if (!menu) return { left: 0, top: 0 };
    const w = 300, h = ref?.offsetHeight ?? 360;
    return { left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)) };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

{#if menu && node}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ctx-scrim" onclick={close} oncontextmenu={(e) => { e.preventDefault(); close(); }}></div>
  <div class="cmenu" data-tour="node-menu" bind:this={ref} role="menu" style="left:{pos.left}px; top:{pos.top}px">
    <div class="ctx-head"><span style="color:{NODE_TYPE_INFO[node.type].color}">{NODE_TYPE_INFO[node.type].icon}</span> <b>{node.title}</b></div>

    {#if many.length}
      <div class="ctx-sect">{many.length} nodes selected</div>
      <div class="ctx-hint">{many.map((id) => app.nodes[id].title).join(' · ')}</div>
      <div class="row">
        <input class="field" list="pnp-groups" placeholder="Group (default: party)" bind:value={customGroup} />
        <datalist id="pnp-groups">{#each groupsOf(campaign) as g}<option value={g}></option>{/each}</datalist>
      </div>
      <button class="ctx-item primary" onclick={hereAll} title="The players are at all of these at once — e.g. in the tavern while the bell is ringing">▶ Players are here at all {many.length}</button>
      <button class="ctx-item" onclick={() => (statusOpen = !statusOpen)}>Set status of all <span class="sp"></span><span class="dim">{statusOpen ? '▾' : '▸'}</span></button>
      {#if statusOpen}
        <div class="ctx-sub">
          {#each STATUS_CHOICES as c}
            <button class="ctx-item" title={c.help} onclick={() => setStatus(c.id)}>{c.icon} {c.label}</button>
          {/each}
        </div>
      {/if}
      <button class="ctx-item" onclick={frameThem} title="A labelled area behind these nodes — they then move together">▭ Frame these {many.length} nodes</button>
      <div class="ctx-sep"></div>
      <button class="ctx-item danger" onclick={() => act('batch', { ops: many.map((id) => ({ command: 'delete_node', args: { id } })), label: `Deleted ${many.length} nodes` })}>Delete {many.length} nodes</button>
    {:else}
    {#if node.type === 'table'}
      <button class="ctx-item primary" onclick={() => act('roll_table', { nodeId: node.id })}>🎲 Roll this table</button>
      <button class="ctx-item" onclick={() => act('roll_table', { nodeId: node.id, times: 3 })}>🎲 Roll three times</button>
      <div class="ctx-sep"></div>
    {/if}
    {#if VISITABLE_TYPES.has(node.type)}
      {#if pcs.length}
        <div class="ctx-sect">Move players here</div>
        <div class="chips">
          <button class="chip all" onclick={() => movePlayers(pcs.map((p) => p.id))} title="Everybody comes together here">Whole party</button>
          {#each fragments.filter((g) => pcs.filter((p) => groupOf(p) === g).length < pcs.length) as g}
            <button class="chip" style="--c:{groupColor(g)}" onclick={() => pickGroup(g)} title="Select this group ({whereIs(g)})"><i></i>{g}</button>
          {/each}
        </div>
        <div class="pcs">
          {#each pcs as p (p.id)}
            <label class="pc" class:on={picked.includes(p.id)}>
              <input type="checkbox" checked={picked.includes(p.id)} onchange={() => toggle(p.id)} />
              <i style="background:{groupColor(groupOf(p))}"></i>
              <span class="nm">{p.title}</span>
              <span class="at">{hereNow(p) ? 'is here' : whereIs(groupOf(p))}</span>
            </label>
          {/each}
        </div>
        <button class="ctx-item primary" disabled={!picked.length} onclick={() => movePlayers(picked)}>
          ▶ {picked.length ? `Move ${picked.length} selected here` : 'Tick the players who go here'}{placed ? '' : ' (adds to story)'}
        </button>
      {:else}
        <div class="ctx-sect">Players are here</div>
        <div class="row">
          <input class="field" list="pnp-groups" placeholder="Group (default: party)" bind:value={customGroup} onkeydown={(e) => e.key === 'Enter' && playedBy(customGroup.trim() || undefined)} />
          <datalist id="pnp-groups">{#each groupsOf(campaign) as g}<option value={g}></option>{/each}</datalist>
          <button class="btn primary" onclick={() => playedBy(customGroup.trim() || undefined)}>▶</button>
        </div>
        <div class="ctx-hint">Connect a VTT to pull your players' characters, then you can pick who goes where.</div>
      {/if}
      <div class="ctx-sep"></div>
      <button class="ctx-item" onclick={() => (statusOpen = !statusOpen)}>Status <span class="sp"></span><span class="dim">{node.status}</span> <span class="dim">{statusOpen ? '▾' : '▸'}</span></button>
      {#if statusOpen}
        <div class="ctx-sub">
          {#each STATUS_CHOICES as c}
            <button class="ctx-item" class:on={node.status === c.id} title={c.help} onclick={() => setStatus(c.id)}>{c.icon} {c.label}{#if node.status === c.id} <span class="sp"></span><span class="dim">now</span>{/if}</button>
          {/each}
        </div>
      {/if}
      <div class="ctx-sep"></div>
    {/if}

    <button class="ctx-item" onclick={() => { selectNode(node.id); close(); }}>Open in inspector</button>
    {#if placed && app.graph.canvases.length > 1}<button class="ctx-item" onclick={() => openCrossLink(node.id)} title="Connect this node to a node on another canvas (next act, side quest …)">↠ Connect to another canvas…</button>{/if}
    {#if placed}<button class="ctx-item" onclick={() => act('move_to_pool', { id: node.id })}>Send to pool</button>{/if}
    <button class="ctx-item danger" onclick={() => act('delete_node', { id: node.id })}>Delete</button>
    {/if}
  </div>
{/if}

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 6px 4px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 99px; border: 1px solid var(--line-2); background: var(--bg-3); color: var(--text); font-size: 11.5px; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .chip:hover { background: var(--bg-4); }
  .chip.all { border-color: color-mix(in srgb, var(--accent, #7aa2ff) 60%, transparent); }
  .pcs { display: flex; flex-direction: column; padding: 0 2px 4px; }
  .pc { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-s); cursor: pointer; font-size: 12.5px; }
  .pc:hover { background: var(--bg-3); }
  .pc.on { background: var(--bg-4); }
  .pc i { width: 9px; height: 9px; border-radius: 50%; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .at { color: var(--text-dim); font-size: 11px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: flex; gap: 6px; padding: 4px 6px; }
  .row .field { flex: 1; min-width: 0; }
</style>
