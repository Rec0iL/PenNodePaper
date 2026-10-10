<script lang="ts">
  import { tick } from 'svelte';
  import type { Batch, ChangeEvent } from '@pnp/shared';
  import { app, focusEdge, focusNode } from '../lib/app.svelte';

  const who: Record<string, { label: string; color: string }> = {
    user: { label: 'You', color: 'var(--accent)' },
    claude: { label: 'Claude', color: 'var(--claude)' },
    agy: { label: 'agy', color: 'var(--agy)' },
    system: { label: 'system', color: 'var(--text-faint)' },
  };

  /** Node id, or "edge:<id>" when the batch touched a connection. */
  function target(b: Batch): string | undefined {
    for (const e of b.events as ChangeEvent[]) {
      if ('id' in e) return e.id;
      if (e.type === 'node.created') return e.node.id;
      if (e.type === 'edge.deleted') return e.edge.from; // the edge is gone: show where it was
      if (e.type.startsWith('edge.')) return `edge:${(e as { edge: { id: string } }).edge.id}`;
    }
  }
  const open = (t: string | undefined) => {
    if (!t) return;
    if (t.startsWith('edge:')) {
      if (app.graph.edges.some((e) => e.id === t.slice(5))) focusEdge(t.slice(5));
    } else if (app.nodes[t]) focusNode(t);
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let box: HTMLDivElement;
  $effect(() => {
    app.history.length;
    void tick().then(() => box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }));
  });
</script>

<section class="act">
  <header>
    <b>Activity</b>
    <span class="dim">every AI action is one undo step</span>
  </header>
  <div class="list" bind:this={box}>
    {#each app.history as b (b.id)}
      {@const w = app.meta.tutorial?.on && b.actor === 'claude' ? { label: 'Tutorial AI', color: 'var(--claude)' } : (who[b.actor] ?? who.system)}
      {@const t = target(b)}
      <button class="row" class:undo={b.undoOf} onclick={() => open(t)}>
        <span class="time">{time(b.at)}</span>
        <span class="badge" style="--c:{w.color}">{w.label}</span>
        <span class="lbl">{b.label}</span>
        <span class="n">{b.events.length}</span>
      </button>
    {:else}
      <div class="empty">Changes show up here as they happen.</div>
    {/each}
  </div>
</section>

<style>
  .act { display: flex; flex-direction: column; min-height: 0; background: var(--bg-2); border-top: 1px solid var(--line); }
  header { padding: 7px 14px; display: flex; gap: 10px; align-items: baseline; border-bottom: 1px solid var(--line); }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .list { overflow: auto; padding: 4px 8px; flex: 1; }
  .row { width: 100%; display: grid; grid-template-columns: 64px 62px 1fr auto; gap: 8px; align-items: center; text-align: left; background: transparent; border: 0; padding: 3px 6px; border-radius: 6px; color: var(--text-dim); animation: pnp-pop 0.25s ease-out; }
  .row:hover { background: var(--bg-3); color: var(--text); }
  .row.undo .lbl { font-style: italic; opacity: 0.75; }
  .time { font-family: var(--mono); font-size: 10.5px; color: var(--text-faint); }
  .badge { font-size: 10px; text-align: center; padding: 0 6px; border-radius: 99px; color: #0a0c11; background: var(--c); font-weight: 600; }
  .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { font-size: 10.5px; color: var(--text-faint); }
  .empty { color: var(--text-faint); padding: 12px; font-size: 12px; }
</style>
