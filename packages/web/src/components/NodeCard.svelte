<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { DEFAULT_GROUP, NODE_TYPE_INFO, clockOf, dieLabel, groupColor, isKnown, portalTarget, tableEntries, tableFaces, visitsOf, type StoryNode } from '@pnp/shared';
  import { app, cmd, gotoPortal } from '../lib/app.svelte';

  const openMap = () => {
    if (data.node.type === 'portal' && !data.ghost) return gotoPortal(data.node);
    const id = data.node.fields?.mapId;
    if (typeof id === 'string' && id && !data.ghost) app.mapEditor = { mapId: id };
  };

  let { id, data, selected }: NodeProps & { data: { node: StoryNode; ghost?: boolean } } = $props();

  const node = $derived(data.node);
  const info = $derived(NODE_TYPE_INFO[node.type] ?? NODE_TYPE_INFO.scene);
  const fx = $derived(app.fx[id] ?? {});
  const present = $derived(app.presence?.nodeId === id ? app.presence : null);
  const cover = $derived(node.images[0]);
  const visits = $derived(visitsOf(node));
  const seq = $derived(visits.length ? Math.min(...visits.map((v) => v.seq)) : null);
  const hereGroups = $derived(visits.filter((v) => v.here).map((v) => v.group));
  const here = $derived(hereGroups.length > 0 && !data.ghost);
  // a node that is merely "in play" (status active, nobody moved there) looks like the party's own marker: same colour, quieter
  const inPlay = $derived(node.status === 'active' && !hereGroups.length && !data.ghost);
  const hereColor = $derived(groupColor(hereGroups[0] ?? DEFAULT_GROUP));
  const clock = $derived(node.type === 'clock' ? clockOf(node) : null);
  const pending = $derived(app.jobs.filter((j) => j.nodeId === node.id && (j.status === 'queued' || j.status === 'running')));
  const painting = $derived(pending.find((j) => j.status === 'running'));
  const table = $derived(node.type === 'table' ? { faces: tableFaces(tableEntries(node)), last: typeof node.fields.last === 'string' ? node.fields.last : '' } : null);
  const proposal = $derived(app.proposals.find((p) => p.nodes.includes(id)));
  const hasMap = $derived(typeof node.fields?.mapId === 'string' && !!node.fields.mapId);
  const known = $derived(node.type === 'clue' && isKnown(node));
  const portal = $derived(node.type === 'portal' ? portalTarget({ nodes: app.nodes, graph: app.graph }, node) : null);
</script>

<div
  class="card"
  role="presentation"
  ondblclick={openMap}
  class:selected
  class:spawn={fx.spawn}
  class:flash={fx.flash}
  class:hidden={fx.hidden}
  class:ghost={data.ghost}
  class:done={node.status === 'done'}
  class:skipped={node.status === 'skipped'}
  class:here={here}
  class:inplay={inPlay}
  class:proposed={!!proposal && !data.ghost}
  class:compact={app.lod === 'compact'}
  style="--tc:{info.color};--glow:{info.color}88;--hc:{hereColor}"
>
  {#if here}
    <div class="heretags">
      {#each hereGroups as g (g)}<span class="heretag" style="background:{groupColor(g)}">▶ {g === DEFAULT_GROUP ? 'players are here' : g}</span>{/each}
    </div>
  {/if}
  {#if proposal && !data.ghost}
    <div class="propose" title="{proposal.actor === 'agy' ? 'agy' : 'Claude'} changed this — keep or reject it in the review bar">✦ {proposal.newNodes.includes(id) ? 'new' : 'changed'}</div>
  {/if}
  {#if inPlay}
    <div class="heretags"><span class="heretag soft" style="background:{hereColor}">◉ in play</span></div>
  {/if}
  {#if present}
    <div class="ring" style="--pc:var(--{present.actor === 'agy' ? 'agy' : 'claude'})">
      <span class="who">{present.actor === 'agy' ? 'agy' : 'Claude'}</span>
    </div>
  {/if}

  <Handle type="target" position={Position.Left} />
  <div class="bar"></div>
  <div class="inner">
    <div class="top">
      <span class="type"><i>{info.icon}</i>{info.label}{#if seq}<b class="seq" title="Order in which the players reached it">#{seq}</b>{/if}{#if known}<b class="known" title="The players know this">◉ known</b>{/if}{#if hasMap}<b class="mapbadge" title="This place has a map — double-click to open it">⌗ map</b>{/if}</span>
      {#if pending.length}<span class="gen" class:wait={!painting} title={painting ? 'An image is being generated' : 'An image is waiting in the queue'}>{painting ? `◌ ${Math.round(painting.progress * 100)}%` : '⏳ queued'}{#if pending.length > 1} ×{pending.length}{/if}</span>{/if}
      {#if node.status !== 'untouched'}
        <span class="status s-{node.status}">{node.status}</span>
      {/if}
    </div>
    <div class="title">{node.title}</div>
    {#if node.summary}<div class="summary">{node.summary}</div>{/if}
    {#if table}
      <div class="tbl">
        <button class="roll nodrag" disabled={!table.faces} onclick={(e) => { e.stopPropagation(); void cmd('roll_table', { nodeId: node.id }); }} title={table.faces ? `Roll the table (${dieLabel(table.faces)})` : 'No entries yet — open the node and add some'}>🎲 {table.faces ? dieLabel(table.faces) : 'empty'}</button>
        {#if table.last}<span class="last" title="Last roll">{table.last}</span>{/if}
      </div>
    {/if}
    {#if portal}
      <button class="portal nodrag" class:broken={!portal.canvas || (!!portal.nodeId && !portal.node)} onclick={(e) => { e.stopPropagation(); gotoPortal(node); }} title={portal.canvas ? 'Jump to the other canvas (or double-click the card)' : 'This portal has no valid target'}>
        {portal.canvas ? `↠ ${portal.canvas.name}${portal.node ? ` · ${portal.node.title}` : ''}` : '⚠ no target'}
      </button>
    {/if}
    {#if clock}
      <div class="clock" class:full={clock.full} title={clock.consequence}>
        <svg viewBox="-12 -12 24 24" width="38" height="38">
          {#each Array(clock.segments) as _, i}
            {@const a0 = (i / clock.segments) * Math.PI * 2 - Math.PI / 2}
            {@const a1 = ((i + 1) / clock.segments) * Math.PI * 2 - Math.PI / 2 - 0.1}
            <path d={`M ${9 * Math.cos(a0)} ${9 * Math.sin(a0)} A 9 9 0 0 1 ${9 * Math.cos(a1)} ${9 * Math.sin(a1)}`} fill="none" stroke-width="4.2" stroke={i < clock.filled ? (clock.full ? '#ff5d73' : '#ff9966') : '#2c3446'} />
          {/each}
        </svg>
        <span>{clock.filled}/{clock.segments}{clock.full ? ' · due' : ''}</span>
      </div>
    {/if}
    {#if node.tags.length}
      <div class="tags">
        {#each node.tags.slice(0, 3) as t}<span class="chip">{t}</span>{/each}
        {#if node.tags.length > 3}<span class="chip">+{node.tags.length - 3}</span>{/if}
      </div>
    {/if}
  </div>
  {#if cover}<img class="thumb" src={`/api/images/${cover}?w=240`} alt="" draggable="false" decoding="async" />{/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .card {
    position: relative;
    width: 280px;
    min-height: 92px;
    display: flex;
    background: linear-gradient(180deg, var(--bg-3), #121621);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    overflow: visible;
    transition: border-color 0.15s, box-shadow 0.2s, opacity 0.2s;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .card:hover { border-color: #3a4560; }
  .card.selected { border-color: var(--tc); box-shadow: 0 0 0 1px var(--tc), 0 0 24px -4px var(--glow); }
  .card.hidden { opacity: 0; }
  .card.spawn { animation: pnp-spawn 1s var(--ease); }
  .card.flash { animation: pnp-flash 1.2s ease-out; }
  .card.ghost { animation: pnp-dissolve 0.8s ease-in forwards; pointer-events: none; }
  .card.done { opacity: 0.72; }
  .card.skipped { opacity: 0.5; }
  .card.skipped .title { text-decoration: line-through; }

  .card.here { border-color: var(--hc); box-shadow: 0 0 0 1px var(--hc), 0 0 30px -4px var(--hc); animation: pnp-here 2.4s ease-in-out infinite; }
  @keyframes pnp-here { 50% { box-shadow: 0 0 0 1px var(--hc), 0 0 44px 0 var(--hc); } }
  .card.inplay { border-color: var(--hc); box-shadow: 0 0 0 1px var(--hc), 0 0 22px -6px var(--hc); }
  .heretag.soft { opacity: 0.85; }
  .heretags { position: absolute; left: 12px; top: -10px; display: flex; gap: 4px; z-index: 2; }
  .heretag { font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #0a0c11; padding: 0 8px; border-radius: 99px; white-space: nowrap; }
  .seq { margin-left: 6px; font-size: 9.5px; color: var(--text-dim); background: var(--bg-4); border: 1px solid var(--line-2); border-radius: 99px; padding: 0 5px; letter-spacing: 0; text-transform: none; }
  .gen { font-size: 9.5px; padding: 0 6px; border-radius: 99px; color: var(--accent); border: 1px solid var(--accent); background: var(--accent-soft); animation: pnp-pulse 1.4s ease-in-out infinite; margin-left: auto; margin-right: 4px; }
  .gen.wait { color: #ffcf70; border-color: #6a4a18; background: #3a2a10; }
  @keyframes pnp-pulse { 50% { opacity: 0.55; } }
  .mapbadge { margin-left: 6px; font-size: 9.5px; color: #7fe0a0; letter-spacing: 0; text-transform: none; font-weight: 500; }
  .known { margin-left: 6px; font-size: 9.5px; color: var(--ok); letter-spacing: 0; text-transform: none; font-weight: 500; }
  .card.proposed { outline: 2px dashed var(--agy, #b89cff); outline-offset: 3px; }
  .propose { position: absolute; right: 10px; top: -10px; z-index: 3; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: var(--agy, #b89cff); color: #0a0c11; padding: 0 8px; border-radius: 99px; }
  /* far zoomed out: only the type colour and a big title — readable at a glance, cheap to draw */
  .card.compact { min-height: 0; }
  .card.compact .summary, .card.compact .tags, .card.compact .thumb, .card.compact .status, .card.compact .gen, .card.compact .tbl .last { display: none; }
  .card.compact .title { font-size: 30px; line-height: 1.15; margin: 4px 0; }
  .card.compact .type { font-size: 17px; }
  .card.compact .heretag, .card.compact .propose { font-size: 15px; padding: 1px 12px; top: -16px; }
  .tbl { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .roll { background: var(--bg-4); border: 1px solid var(--line-2); color: var(--text); border-radius: 8px; padding: 2px 9px; font-size: 11.5px; white-space: nowrap; }
  .roll:hover:not(:disabled) { border-color: var(--accent); }
  .roll:disabled { opacity: .5; }
  .portal { margin-top: 6px; align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; background: color-mix(in srgb, var(--tc) 18%, var(--bg-4)); border: 1px solid var(--tc); color: var(--text); border-radius: 8px; padding: 3px 10px; font-size: 12px; white-space: nowrap; cursor: pointer; }
  .portal:hover { background: color-mix(in srgb, var(--tc) 30%, var(--bg-4)); }
  .portal.broken { border-color: var(--danger, #ff5d73); color: var(--danger, #ff5d73); }
  .last { font-size: 12px; color: var(--accent); font-style: italic; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .clock { display: flex; align-items: center; gap: 8px; margin-top: 5px; font-size: 11.5px; color: var(--text-dim); }
  .clock.full { color: #ff8da0; }
  .bar { width: 4px; flex: none; background: var(--tc); border-radius: var(--radius) 0 0 var(--radius); box-shadow: 0 0 14px var(--glow); }
  .inner { flex: 1; min-width: 0; padding: 9px 11px 10px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .type { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--tc); display: inline-flex; gap: 5px; align-items: center; }
  .type i { font-style: normal; font-size: 12px; }
  .status { font-size: 9.5px; padding: 0 6px; border-radius: 99px; border: 1px solid var(--line-2); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; }
  .s-active { color: var(--hc); border-color: var(--hc); background: color-mix(in srgb, var(--hc) 14%, transparent); }
  .s-done { color: var(--ok); border-color: #2c5a3e; }
  .title { font-weight: 600; font-size: 14px; margin: 3px 0 2px; line-height: 1.25; color: var(--text); }
  .summary { color: var(--text-dim); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tags { margin-top: 7px; display: flex; gap: 4px; flex-wrap: wrap; }
  .thumb { width: 64px; object-fit: cover; border-radius: 0 var(--radius) var(--radius) 0; border-left: 1px solid var(--line-2); }

  .ring {
    position: absolute; inset: -6px; border-radius: 16px; pointer-events: none;
    border: 2px solid var(--pc); box-shadow: 0 0 22px -2px var(--pc), inset 0 0 14px -6px var(--pc);
    animation: pnp-ring 1.1s ease-in-out infinite;
  }
  .who {
    position: absolute; top: -11px; left: 14px; font-size: 10px; font-weight: 600; letter-spacing: 0.05em;
    background: var(--pc); color: #0a0c11; padding: 0 7px; border-radius: 99px;
  }
</style>
