<script lang="ts">
  import { FRAME_PALETTE } from '@pnp/shared';
  import { app, cmd, closeMenus } from '../lib/app.svelte';

  const COLORS = FRAME_PALETTE;
  const menu = $derived(app.frameMenu);
  const frame = $derived(menu ? app.graph.frames.find((f) => f.id === menu.frameId) : undefined);
  const inside = $derived(
    frame ? Object.entries(app.graph.placements).filter(([, p]) => p.canvas === frame.canvas && p.x + 140 >= frame.x && p.x + 140 <= frame.x + frame.w && p.y + 46 >= frame.y && p.y + 46 <= frame.y + frame.h).length : 0,
  );
  async function act(name: string, args: Record<string, unknown>) {
    closeMenus();
    await cmd(name, args);
  }
  const pos = $derived(menu ? { left: Math.max(8, Math.min(menu.x, window.innerWidth - 268)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 250)) } : { left: 0, top: 0 });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeMenus()} />

{#if menu && frame}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ctx-scrim" onclick={closeMenus} oncontextmenu={(e) => { e.preventDefault(); closeMenus(); }}></div>
  <div class="cmenu fm" role="menu" style="left:{pos.left}px; top:{pos.top}px">
    <div class="ctx-head"><span style="color:{frame.color}">▭</span> <b>{frame.title}</b></div>
    <div class="ctx-hint">{inside} node{inside === 1 ? '' : 's'} inside — they move with the frame (drag its title).</div>
    <div class="ctx-sect">Colour</div>
    <div class="sw">{#each COLORS as c}<button class:on={frame.color === c} style="--c:{c}" aria-label={c} onclick={() => act('update_frame', { id: frame.id, color: c })}></button>{/each}</div>
    <div class="ctx-sep"></div>
    <button class="ctx-item" onclick={() => { app.editingFrame = frame.id; closeMenus(); }}>✎ Rename</button>
    <button class="ctx-item danger" onclick={() => act('delete_frame', { id: frame.id })}>Remove the frame <span class="sp"></span><span class="dim">nodes stay</span></button>
  </div>
{/if}

<style>
  .fm { width: 260px; }
  .sw { display: flex; gap: 6px; padding: 4px 8px 6px; flex-wrap: wrap; }
  .sw button { width: 22px; height: 22px; border-radius: 50%; background: var(--c); border: 2px solid transparent; padding: 0; }
  .sw button.on { border-color: var(--text); }
</style>
