<script lang="ts">
  // Review mode: what the AI changed is already on the canvas (marked "proposed"); keep it or take it back.
  import { app, cmd, focusNode, say } from '../lib/app.svelte';

  const list = $derived(app.proposals);
  let busy = $state(false);

  async function act(name: 'accept_proposal' | 'reject_proposal', id?: string) {
    busy = true;
    await cmd(name, id ? { id } : {});
    busy = false;
  }
  const show = (nodes: string[]) => {
    const first = nodes.find((n) => app.graph.placements[n]);
    if (first) focusNode(first);
    else say('Those nodes are in the pool', 'ok');
  };
  const who = (a: string) => (app.meta.tutorial?.on && a === 'claude' ? 'Tutorial AI' : a === 'agy' ? 'agy' : 'Claude');
  const sum = (p: (typeof list)[number]) => [p.newNodes.length ? `${p.newNodes.length} new node${p.newNodes.length > 1 ? 's' : ''}` : '', p.linked ? `${p.linked} link${p.linked > 1 ? 's' : ''}` : '', `${p.steps.length} step${p.steps.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
</script>

{#if list.length}
  <div class="rv" data-tour="review-bar" role="region" aria-label="Review the AI's changes">
    <div class="rh"><b>✦ Review</b><span class="dim">{list.length} change set{list.length > 1 ? 's' : ''} from the AI — already on the canvas, marked “proposed”</span>
      {#if list.length > 1}<span class="grow"></span><button class="btn sm" disabled={busy} onclick={() => act('accept_proposal')}>Accept all</button><button class="btn sm danger" disabled={busy} onclick={() => act('reject_proposal')}>Reject all</button>{/if}
    </div>
    {#each list as p (p.id)}
      <div class="row">
        <div class="tx"><span class="who" class:agy={p.actor === 'agy'}>{who(p.actor)}</span><span class="ti" title={p.steps.join('\n')}>{p.title}</span><span class="dim">{sum(p)}</span></div>
        <button class="btn sm ghost" onclick={() => show(p.nodes)}>Show</button>
        <button class="btn sm primary" disabled={busy} onclick={() => act('accept_proposal', p.id)}>✓ Keep</button>
        <button class="btn sm danger" disabled={busy} onclick={() => act('reject_proposal', p.id)}>↶ Reject</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .rv { width: auto; min-width: 0; background: color-mix(in srgb, var(--bg-2) 94%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--agy, #b89cff); border-radius: var(--radius); padding: 8px 10px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45); display: grid; gap: 6px; }
  .rh { display: flex; align-items: center; gap: 8px; font-size: 12.5px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tx { flex: 1 1 200px; min-width: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .who { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--claude, #ff9d6c); }
  .who.agy { color: var(--agy, #b89cff); }
  .ti { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sm { padding: 1px 9px; font-size: 11.5px; }
</style>
