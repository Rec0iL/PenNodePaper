<script lang="ts">
  // The players' characters (pulled from the VTT, kept offline). Click = open, colour ring = which part of the party.
  import { DEFAULT_GROUP, groupColor, visitsOf, type StoryNode } from '@pnp/shared';
  import { app, cmd, selectNode } from '../lib/app.svelte';

  const pcs = $derived(
    Object.values(app.nodes)
      .filter((n) => n.type === 'pc' && !n.trashed)
      .sort((a, b) => Number(b.fields.present !== false) - Number(a.fields.present !== false) || a.title.localeCompare(b.title)),
  );
  const canSync = $derived(!!app.vtt?.connected && !!app.vtt.profile?.provides?.party);
  let syncing = $state(false);

  const groupOf = (p: StoryNode) => (typeof p.fields.group === 'string' && p.fields.group ? p.fields.group : DEFAULT_GROUP);
  function whereIs(p: StoryNode): string {
    const g = groupOf(p);
    const at = Object.values(app.nodes).filter((n) => !n.trashed && visitsOf(n).some((v) => v.here && v.group === g));
    return at.length ? at.map((n) => n.title).join(', ') : 'nowhere yet';
  }
  const tip = (p: StoryNode) =>
    [p.title, p.fields.playerName ? `player: ${p.fields.playerName}` : '', `at: ${whereIs(p)}`, p.fields.present === false ? 'no longer in the VTT session' : p.fields.online ? 'online' : 'offline'].filter(Boolean).join(' · ');

  async function sync() {
    syncing = true;
    try { await cmd('sync_party'); } finally { syncing = false; }
  }
</script>

{#if pcs.length || canSync}
  <div class="party">
    <div class="ph">
      <b>Party</b><span class="chip">{pcs.filter((p) => p.fields.present !== false).length}</span>
      {#if canSync}<button class="btn ghost" disabled={syncing} onclick={sync} title="Fetch the players' characters from the VTT now">{syncing ? '…' : '↻ Sync'}</button>{/if}
    </div>
    {#if pcs.length}
      <div class="chips">
        {#each pcs as p (p.id)}
          <button class="pc" class:sel={app.selectedId === p.id} class:gone={p.fields.present === false} onclick={() => selectNode(p.id)} title={tip(p)}>
            <span class="av" style="--ring:{groupColor(groupOf(p))}">
              {#if p.images[0]}<img src={`/api/images/${p.images[0]}?w=96`} alt="" draggable="false" />{:else}{p.title.charAt(0)}{/if}
              {#if p.fields.online}<i class="on"></i>{/if}
            </span>
            <span class="nm">{p.title.split(/\s+/)[0]}</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="hint">No characters yet — they appear here when the VTT session reports its players.</p>
    {/if}
  </div>
{/if}

<style>
  .party { padding: 0 12px 10px; display: grid; gap: 6px; border-bottom: 1px solid var(--line); }
  .ph { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .ph .btn { margin-left: auto; padding: 1px 8px; font-size: 11px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pc { display: flex; align-items: center; gap: 6px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 99px; padding: 2px 10px 2px 3px; color: var(--text); font-size: 12px; }
  .pc:hover { border-color: #3a4560; }
  .pc.sel { border-color: var(--accent); }
  .pc.gone { opacity: .5; }
  .pc.gone .nm { text-decoration: line-through; }
  .av { position: relative; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--bg-4); box-shadow: 0 0 0 2px var(--ring); font-size: 11px; font-weight: 600; }
  .av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .av .on { position: absolute; right: -2px; bottom: -2px; width: 7px; height: 7px; border-radius: 50%; background: #6fe08a; box-shadow: 0 0 0 1.5px var(--bg-3); }
  .hint { margin: 0; font-size: 11px; color: var(--text-faint); line-height: 1.4; }
</style>
