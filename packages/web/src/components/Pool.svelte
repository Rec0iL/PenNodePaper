<script lang="ts">
  import { NODE_TYPE_INFO, type StoryNode } from '@pnp/shared';
  import { app, cmd, poolNodes as allPoolNodes, selectNode } from '../lib/app.svelte';
  import PartyStrip from './PartyStrip.svelte';

  // player characters live in the Party strip, not in the pool
  const poolNodes = () => allPoolNodes().filter((n) => n.type !== 'pc');

  let q = $state('');
  let group = $state<'all' | 'story' | 'world' | 'helper'>('all');
  let showTrash = $state(false);

  const items = $derived(
    poolNodes().filter((n) => {
      if (group !== 'all' && NODE_TYPE_INFO[n.type].group !== group) return false;
      const s = q.trim().toLowerCase();
      return !s || `${n.title} ${n.summary} ${n.poolHint} ${n.tags.join(' ')}`.toLowerCase().includes(s);
    }),
  );
  const trash = $derived(Object.values(app.nodes).filter((n) => n.trashed));
  const total = $derived(poolNodes().length);

  function dragstart(e: DragEvent, n: StoryNode) {
    e.dataTransfer!.setData('application/x-pnp-node', n.id);
    e.dataTransfer!.effectAllowed = 'move';
    selectNode(n.id);
  }
</script>

<aside class="pool" data-pool-drop data-tour="pool">
  <div class="partywrap"><PartyStrip /></div>
  <header>
    <div class="h"><b>Pool</b><span class="chip">{total}</span></div>
    <p class="hint">Prepared, but no place in the story yet. Drag onto the canvas when it happens — or drag nodes back here.</p>
    <input class="field" placeholder="Search pool…" bind:value={q} />
    <div class="groups">
      {#each ['all', 'story', 'world', 'helper'] as g}
        <button class:on={group === g} onclick={() => (group = g as typeof group)}>{g}</button>
      {/each}
    </div>
  </header>

  <div class="list">
    {#each items as n (n.id)}
      {@const info = NODE_TYPE_INFO[n.type]}
      <div
        class="item"
        class:sel={app.selectedId === n.id}
        class:hid={app.fx[`pool:${n.id}`]?.hidden}
        class:spawn={app.fx[n.id]?.spawn}
        class:flash={app.fx[n.id]?.flash}
        data-pool-id={n.id}
        style="--tc:{info.color}"
        draggable="true"
        role="button"
        tabindex="0"
        ondragstart={(e) => dragstart(e, n)}
        onclick={() => selectNode(n.id)}
        onkeydown={(e) => e.key === 'Enter' && selectNode(n.id)}
      >
        <div class="top">
          <span class="type"><i>{info.icon}</i>{info.label}</span>
          <button class="go" title="Place on the canvas" onclick={(e) => { e.stopPropagation(); void cmd('place_on_canvas', { id: n.id, canvas: app.canvasId, nearNodeId: app.selectedId && app.graph.placements[app.selectedId] ? app.selectedId : undefined }); }}>→</button>
        </div>
        <div class="title">{n.title}</div>
        {#if n.summary}<div class="sum">{n.summary}</div>{/if}
        {#if n.poolHint}<div class="when">⏱ {n.poolHint}</div>{/if}
        {#if n.tags.length}<div class="tags">{#each n.tags as t}<span class="chip">{t}</span>{/each}</div>{/if}
      </div>
    {:else}
      <div class="empty">{total ? 'Nothing matches.' : 'The pool is empty. Create nodes with “+ Pool” or ask the AI to prepare some.'}</div>
    {/each}
  </div>

  {#if trash.length}
    <footer>
      <button class="trashbtn" onclick={() => (showTrash = !showTrash)}>🗑 Trash <span class="chip">{trash.length}</span></button>
      {#if showTrash}
        <div class="trash">
          {#each trash as n (n.id)}
            <div class="trow"><span>{n.title}</span><button class="btn ghost" onclick={() => cmd('restore_node', { id: n.id })}>restore</button></div>
          {/each}
        </div>
      {/if}
    </footer>
  {/if}
</aside>

<style>
  .pool { display: flex; flex-direction: column; background: var(--bg-2); border-right: 1px solid var(--line); min-height: 0; }
  .partywrap { padding-top: 10px; }
  .partywrap:empty { display: none; }
  header { padding: 12px 12px 8px; display: grid; gap: 8px; }
  .h { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .hint { margin: 0; font-size: 11.5px; color: var(--text-faint); line-height: 1.4; }
  .groups { display: flex; gap: 4px; }
  .groups button { flex: 1; background: transparent; border: 1px solid var(--line); color: var(--text-dim); border-radius: 99px; padding: 2px 0; font-size: 11px; text-transform: capitalize; }
  .groups button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  .list { flex: 1; overflow: auto; padding: 4px 10px 12px; display: grid; gap: 8px; align-content: start; }
  .item {
    position: relative; text-align: left; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 3px solid var(--tc);
    border-radius: var(--radius-s); padding: 8px 10px; cursor: grab; transition: border-color 0.15s, transform 0.15s, opacity 0.2s, box-shadow 0.2s; --glow: color-mix(in srgb, var(--tc) 55%, transparent);
  }
  .item:hover { border-color: #3a4560; border-left-color: var(--tc); transform: translateX(2px); }
  .item:active { cursor: grabbing; }
  .item.sel { box-shadow: 0 0 0 1px var(--tc), 0 0 18px -6px var(--tc); }
  .item.hid { opacity: 0; }
  .item.spawn { animation: pnp-spawn 1s var(--ease); }
  .item.flash { animation: pnp-flash 1.2s ease-out; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  .type { font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--tc); display: inline-flex; gap: 5px; }
  .type i { font-style: normal; }
  .go { background: transparent; border: 1px solid var(--line-2); color: var(--text-dim); border-radius: 6px; width: 24px; height: 20px; line-height: 1; opacity: 0; transition: opacity 0.15s; }
  .item:hover .go { opacity: 1; }
  .go:hover { color: var(--text); border-color: var(--accent); }
  .title { font-weight: 600; margin: 2px 0; }
  .sum { color: var(--text-dim); font-size: 12px; }
  .when { margin-top: 5px; font-size: 11px; color: #c8b27a; font-style: italic; }
  .tags { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
  .empty { color: var(--text-faint); padding: 18px 8px; text-align: center; font-size: 12px; }
  footer { border-top: 1px solid var(--line); padding: 8px 10px; }
  .trashbtn { background: transparent; border: 0; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
  .trash { margin-top: 6px; display: grid; gap: 2px; max-height: 140px; overflow: auto; }
  .trow { display: flex; justify-content: space-between; align-items: center; color: var(--text-dim); font-size: 12px; }
</style>
