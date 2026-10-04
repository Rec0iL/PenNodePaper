<script lang="ts">
  // Ctrl/Cmd+K: jump to any node by what you remember of it (title, tag, a line of text), or run an action (type ">").
  import { tick } from 'svelte';
  import { NODE_TYPE_INFO, searchNodes, type CampaignState } from '@pnp/shared';
  import { app, cmd, focusNode, redo, undo, viewCenter } from '../lib/app.svelte';

  let q = $state('');
  let at = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();

  const campaign = $derived({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState);
  const actionMode = $derived(q.trimStart().startsWith('>'));

  interface Action { label: string; hint?: string; run: () => void }
  const actions: Action[] = [
    { label: 'New scene here', hint: 'on the canvas, in the middle of the view', run: () => void cmd('create_node', { type: 'scene', title: 'Scene', place: 'canvas', ...viewCenter() }) },
    { label: 'New NPC (pool)', run: () => void cmd('create_node', { type: 'npc', title: 'NPC', place: 'pool' }) },
    { label: 'Undo', hint: 'Ctrl+Z', run: () => void undo() },
    { label: 'Redo', hint: 'Ctrl+Shift+Z', run: () => void redo() },
    { label: 'Open the Story tab', run: () => (app.tab = 'story') },
    { label: 'Open the AI chat', run: () => (app.tab = 'chat') },
    { label: 'Open the Library', run: () => (app.tab = 'library') },
    { label: 'Open the Inspector', run: () => (app.tab = 'inspector') },
    { label: 'Backups & sync…', run: () => (app.backupsOpen = true) },
    { label: 'GM binder (PDF)…', run: () => (app.binderOpen = true) },
    { label: 'Settings…', run: () => (app.settingsOpen = true) },
    { label: 'Toggle “follow AI”', run: () => (app.followAi = !app.followAi) },
  ];

  const hits = $derived(actionMode ? [] : searchNodes(campaign, q, 40));
  const acts = $derived(actionMode ? actions.filter((a) => a.label.toLowerCase().includes(q.replace(/^\s*>\s*/, '').toLowerCase())) : []);
  const count = $derived(actionMode ? acts.length : hits.length);

  $effect(() => { void q; at = 0; });
  $effect(() => { if (app.paletteOpen) { q = ''; void tick().then(() => input?.focus()); } });

  const close = () => (app.paletteOpen = false);

  function pick(i: number) {
    if (actionMode) {
      const a = acts[i];
      if (!a) return;
      close();
      a.run();
      return;
    }
    const h = hits[i];
    if (!h) return;
    close();
    focusNode(h.id);
    // a prepared (pool) node: bring it into view in the sidebar
    if (!app.graph.placements[h.id]) void tick().then(() => document.querySelector(`[data-pool-id="${h.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(count - 1, at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(at); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    void tick().then(() => list?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if app.paletteOpen}
  <div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && close()}>
    <div class="pal" role="dialog" aria-label="Search">
      <input bind:this={input} class="q" placeholder="Search nodes…   type:npc  #tag  is:pool   ·   &gt; for actions" bind:value={q} onkeydown={key} spellcheck="false" />
      <div class="res" bind:this={list}>
        {#if actionMode}
          {#each acts as a, i (a.label)}
            <button class="r" class:on={i === at} onmouseenter={() => (at = i)} onclick={() => pick(i)}><span class="ic">›</span><span class="t">{a.label}</span>{#if a.hint}<span class="dim">{a.hint}</span>{/if}</button>
          {:else}<div class="empty">No such action.</div>{/each}
        {:else}
          {#each hits as h, i (h.id)}
            {@const n = app.nodes[h.id]}
            {@const info = NODE_TYPE_INFO[n.type]}
            <button class="r" class:on={i === at} onmouseenter={() => (at = i)} onclick={() => pick(i)}>
              <span class="ic" style="color:{info.color}">{info.icon}</span>
              <span class="t">{n.title}</span>
              <span class="chips">
                <span class="chip">{info.label}</span>
                {#if !app.graph.placements[h.id]}<span class="chip pool">pool</span>{/if}
                {#if n.status !== 'untouched'}<span class="chip">{n.status}</span>{/if}
              </span>
              {#if h.snippet}<span class="sn">{h.snippet}</span>{/if}
            </button>
          {:else}<div class="empty">{q.trim() ? 'Nothing matches.' : 'The campaign is empty.'}</div>{/each}
        {/if}
      </div>
      <div class="foot"><span>↑↓ choose · Enter opens · Esc closes</span><span>{count} {actionMode ? 'actions' : 'nodes'}</span></div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 1600; background: rgba(5, 6, 9, 0.6); backdrop-filter: blur(3px); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; animation: pnp-pop 0.12s ease-out; }
  .pal { width: min(640px, 94vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  .q { background: transparent; border: 0; border-bottom: 1px solid var(--line); color: var(--text); font-size: 16px; padding: 14px 16px; outline: none; }
  .res { overflow: auto; padding: 6px; display: grid; gap: 1px; }
  .r { display: grid; grid-template-columns: 22px 1fr auto; column-gap: 8px; align-items: center; text-align: left; background: transparent; border: 0; color: var(--text); padding: 7px 10px; border-radius: 8px; }
  .r.on { background: var(--bg-4); }
  .ic { text-align: center; font-size: 14px; }
  .t { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; gap: 4px; }
  .chip.pool { color: #ffcf70; border-color: #6a4a18; background: #3a2a10; }
  .sn { grid-column: 2 / -1; font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .empty { padding: 18px; text-align: center; color: var(--text-faint); font-size: 12.5px; }
  .foot { display: flex; justify-content: space-between; padding: 7px 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--text-faint); }
</style>
