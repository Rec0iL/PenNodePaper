<script lang="ts">
  // The ? in the top bar: the welcome tour, its chapters, and the keys worth knowing.
  import { app } from '../lib/app.svelte';
  import { CHAPTERS, STEPS } from '../lib/tour/steps';
  import { isPractice, jumpToChapter, loadSaved, restartTour, resumeTour, tour } from '../lib/tour.svelte';

  let open = $state(false);
  let keys = $state(false);
  // the coach card's ☰ button opens this menu too (the ? in the top bar is under the dimmed layer while a step runs)
  $effect(() => { if (tour.menu) { tour.menu = false; open = true; keys = false; loadSaved(); } });
  const practice = $derived(isPractice());
  const savedIdx = $derived(STEPS.findIndex((s) => s.id === tour.saved));
  const savedChapter = $derived(savedIdx >= 0 ? STEPS[savedIdx].chapter : '');
  const pct = $derived(savedIdx >= 0 ? Math.round((savedIdx / STEPS.length) * 100) : 0);

  function toggle() {
    open = !open;
    keys = false;
    if (open) loadSaved();
  }
  const close = () => { open = false; keys = false; };

  const KEYS: [string, string][] = [
    ['Ctrl Z / Ctrl Shift Z', 'Undo / redo — yours and the AI’s'],
    ['Ctrl K', 'Search nodes; start with > for actions'],
    ['Double-click a card', 'Enlarge it in place (Esc puts it back)'],
    ['Right-click', 'Menus for cards, connections and the empty canvas'],
    ['Shift + drag', 'Select several cards at once'],
    ['Delete', 'Remove the selected cards or lines (to the trash)'],
    ['Space + drag', 'Move around in the map editor'],
    ['Esc', 'Close menus, dialogs and enlarged cards'],
  ];
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && open && close()} />

<div class="tm">
  <button class="btn ghost help" class:on={open || tour.open} data-tour="help" title="Welcome tour and help" onclick={toggle}>?</button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="ctx-scrim" onclick={close}></div>
    <div class="pop" role="menu">
      {#if keys}
        <div class="sect">Keys worth knowing</div>
        {#each KEYS as [k, d]}<div class="key"><kbd>{k}</kbd><span>{d}</span></div>{/each}
        <button class="item" onclick={() => (keys = false)}>‹ Back</button>
      {:else}
        <div class="sect">Welcome tour</div>
        {#if practice && tour.saved && savedChapter}
          <button class="item primary" onclick={() => { close(); void resumeTour(); }}>▶ Continue <span class="dim">— {CHAPTERS.find((c) => c.id === savedChapter)?.title} · {pct}%</span></button>
        {/if}
        <button class="item" onclick={() => { close(); void restartTour(); }}>
          {practice ? '↺ Start the tour again' : '▶ Start the welcome tour'}
          <span class="dim">{practice ? '— resets this practice campaign' : '— opens a separate practice campaign; yours stays untouched'}</span>
        </button>
        {#if practice}
          <div class="sect">Chapters</div>
          {#each CHAPTERS as c, i (c.id)}
            <button class="item ch" onclick={() => { close(); void jumpToChapter(c.id); }}>
              <b>{i + 1}</b><span class="t">{c.title}<span class="dim"> · {c.blurb}</span></span>
            </button>
          {/each}
        {/if}
        <div class="sect">Help</div>
        <button class="item" onclick={() => (keys = true)}>⌨ Keys worth knowing</button>
        <button class="item" onclick={() => { close(); app.settingsOpen = true; }}>⚙ Settings — ComfyUI, style, VTT link, LAN</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tm { position: relative; }
  .help { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 1px solid var(--line-2); font-weight: 700; color: var(--text-dim); }
  .help.on, .help:hover { border-color: var(--accent); color: var(--text); }
  .pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 1500; width: 360px; max-height: 80vh; overflow: auto; padding: 6px; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); }
  .sect { padding: 8px 8px 3px; font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-faint); }
  .item { display: block; width: 100%; text-align: left; background: transparent; border: 0; color: var(--text); padding: 7px 9px; border-radius: 8px; font-size: 12.5px; line-height: 1.35; }
  .item:hover { background: var(--bg-3); }
  .item.primary { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
  .item.ch { display: grid; grid-template-columns: 22px 1fr; gap: 6px; align-items: baseline; }
  .item.ch b { color: var(--accent); font-size: 11px; text-align: right; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .key { display: grid; grid-template-columns: 150px 1fr; gap: 8px; padding: 4px 8px; font-size: 12px; color: var(--text-dim); }
  kbd { font: 11px var(--mono); background: var(--bg-4); border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; color: var(--text); justify-self: start; }
</style>
