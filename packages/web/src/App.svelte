<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { lintStory, type CampaignState } from '@pnp/shared';
  import { activeJobs, app, cmd, connect, redo, resetPanelSize, selectNode, setPanelSize, undo } from './lib/app.svelte';
  import { IMAGE_KINDS } from '@pnp/shared';
  import Activity from './components/Activity.svelte';
  import Canvas from './components/Canvas.svelte';
  import Chat from './components/Chat.svelte';
  import CampaignMenu from './components/CampaignMenu.svelte';
  import Flyers from './components/Flyers.svelte';
  import NodeMenu from './components/NodeMenu.svelte';
  import EdgeMenu from './components/EdgeMenu.svelte';
  import FrameMenu from './components/FrameMenu.svelte';
  import PaneMenu from './components/PaneMenu.svelte';
  import Inspector from './components/Inspector.svelte';
  import Library from './components/Library.svelte';
  import Lightbox from './components/Lightbox.svelte';
  import MapEditor from './components/MapEditor.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import BinderModal from './components/BinderModal.svelte';
  import BackupModal from './components/BackupModal.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import WorldEditor from './components/WorldEditor.svelte';
  import Pool from './components/Pool.svelte';
  import StoryPanel from './components/StoryPanel.svelte';

  // the canvas keeps at least this much room, whatever sizes were dragged on a bigger screen before
  let innerW = $state(typeof window === 'undefined' ? 1400 : window.innerWidth);
  const eff = $derived.by(() => {
    const MIN_CANVAS = 380;
    let l = app.layout.left, r = app.layout.right;
    const over = l + r - (innerW - MIN_CANVAS);
    if (over > 0) {
      r = Math.max(280, r - over);
      const over2 = l + r - (innerW - MIN_CANVAS);
      if (over2 > 0) l = Math.max(200, l - over2);
    }
    return { l, r };
  });

  const warnCount = $derived(lintStory({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState).filter((i) => i.level === 'warn').length);

  const queue = $derived(activeJobs());
  $effect(() => { if (!queue.length) app.queueOpen = false; });

  onMount(() => {
    connect();
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        app.paletteOpen = !app.paletteOpen;
        return;
      }
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // drag a splitter: pointer capture keeps the drag alive over the canvas and the dock
  function drag(which: 'left' | 'right' | 'bottom', e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.parentElement!.getBoundingClientRect();
      if (which === 'left') setPanelSize('left', ev.clientX - r.left);
      else if (which === 'right') setPanelSize('right', r.right - ev.clientX);
      else setPanelSize('bottom', r.bottom - ev.clientY);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function nudge(which: 'left' | 'right' | 'bottom', e: KeyboardEvent) {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0;
    if (!d) return;
    e.preventDefault();
    const sign = which === 'right' ? -1 : 1;
    setPanelSize(which, app.layout[which] + (which === 'bottom' ? d : sign * d));
  }

  async function setAiMode(mode: 'live' | 'review') {
    await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aiMode: mode }) });
  }

  async function addCanvas() {
    const name = prompt('Name of the new canvas (e.g. “Act II”)');
    if (!name?.trim()) return;
    const r = await cmd<{ id: string }>('create_canvas', { name: name.trim() });
    if (r) app.canvasId = r.id;
  }
</script>

<svelte:window bind:innerWidth={innerW} />

<div class="shell" style="--wl:{eff.l}px; --wr:{eff.r}px; --hb:{app.layout.bottom}px">
  <header class="top">
    <div class="brand"><span class="logo">◈</span><b>PenNodePaper</b><CampaignMenu /></div>
    <nav class="tabs">
      {#each app.graph.canvases as c (c.id)}
        <button class:on={app.canvasId === c.id} onclick={() => (app.canvasId = c.id)}>{c.name}</button>
      {/each}
      <button class="plus" title="New canvas" onclick={addCanvas}>+</button>
    </nav>
    <div class="spacer"></div>
    {#if queue.length}
      <div class="qwrap">
        <button class="qchip" onclick={() => (app.queueOpen = !app.queueOpen)} title="Image queue — click for the list">
          <i></i>{queue.filter((j) => j.status === 'running').length ? 'generating' : ''}{queue.some((j) => j.status === 'queued') ? ` · ${queue.filter((j) => j.status === 'queued').length} queued` : ''}
        </button>
        {#if app.queueOpen}
          <div class="qlist">
            {#each queue as j, i (j.id)}
              <button class="qrow" onclick={() => { selectNode(j.nodeId); app.queueOpen = false; }}>
                <span class="qs" class:run={j.status === 'running'}>{j.status === 'running' ? `${Math.round(j.progress * 100)}%` : `#${i}`}</span>
                <span class="qt">{app.nodes[j.nodeId]?.title ?? j.nodeId}</span>
                <span class="qk">{j.kind === 'map' ? 'Map' : IMAGE_KINDS[j.kind].label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <button class="searchbtn" onclick={() => (app.paletteOpen = true)} title="Search nodes and actions (Ctrl+K)">🔍 <span>Search</span> <kbd>Ctrl K</kbd></button>
    <button class="vttchip" class:on={app.vtt?.connected} onclick={() => (app.settingsOpen = true)} title="VTT link — click for pairing and export">
      <i></i>{app.vtt?.connected ? app.vtt.profile?.name : 'no VTT'}
    </button>
    <button class="btn ghost" onclick={() => (app.settingsOpen = true)} title="Settings (ComfyUI, image style, language, VTT)">⚙</button>
    <div class="aimode" role="group" aria-label="What happens to the AI's edits" title="Live: the AI's edits stand until you undo them. Review: they wait for your Keep / Reject after the AI is done.">
      <span class="dim">AI edits</span>
      <button class:on={(app.meta.aiMode ?? 'live') === 'live'} onclick={() => setAiMode('live')}>live</button>
      <button class:on={app.meta.aiMode === 'review'} onclick={() => setAiMode('review')}>review{#if app.proposals.length}<b class="rc">{app.proposals.length}</b>{/if}</button>
    </div>
    <label class="toggle" title="Camera follows the AI while it edits">
      <input type="checkbox" bind:checked={app.followAi} /> follow AI
    </label>
    <button class="btn" disabled={!app.canUndo} onclick={() => undo()} title="Undo (Ctrl+Z)">↶</button>
    <button class="btn" disabled={!app.canRedo} onclick={() => redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
    <span class="dot" class:on={app.connected} title={app.connected ? 'connected' : 'reconnecting…'}></span>
  </header>

  <Pool />

  <main class="center">
    <SvelteFlowProvider><Canvas /></SvelteFlowProvider>
    {#if !app.loaded}<div class="loading">connecting…</div>{/if}
  </main>

  <aside class="dock">
    <div class="dtabs">
      <button class:on={app.tab === 'inspector'} onclick={() => (app.tab = 'inspector')}>Inspector</button>
      <button class:on={app.tab === 'story'} onclick={() => (app.tab = 'story')}>Story{#if warnCount}<span class="wc">{warnCount}</span>{/if}</button>
      <button class:on={app.tab === 'library'} onclick={() => (app.tab = 'library')}>Library</button>
      <button class:on={app.tab === 'chat'} onclick={() => (app.tab = 'chat')}>AI{#if app.chatStatus.busy}<i class="busy"></i>{/if}</button>
    </div>
    <div class="dbody">
      {#if app.tab === 'inspector'}<Inspector />{:else if app.tab === 'story'}<StoryPanel />{:else if app.tab === 'library'}<Library />{:else}<Chat />{/if}
    </div>
  </aside>

  <div class="bottom"><Activity /></div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="split v" role="separator" aria-orientation="vertical" aria-label="Resize the pool" tabindex="0" style="left: calc(var(--wl) - 3px)" onpointerdown={(e) => drag('left', e)} ondblclick={() => resetPanelSize('left')} onkeydown={(e) => nudge('left', e)}></div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="split v" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" tabindex="0" style="right: calc(var(--wr) - 3px)" onpointerdown={(e) => drag('right', e)} ondblclick={() => resetPanelSize('right')} onkeydown={(e) => nudge('right', e)}></div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="split h" role="separator" aria-orientation="horizontal" aria-label="Resize the activity strip" tabindex="0" style="left: var(--wl); right: var(--wr); bottom: calc(var(--hb) - 3px)" onpointerdown={(e) => drag('bottom', e)} ondblclick={() => resetPanelSize('bottom')} onkeydown={(e) => nudge('bottom', e)}></div>
</div>

<Flyers />
<NodeMenu />
<EdgeMenu />
<PaneMenu />
<FrameMenu />
<CommandPalette />
{#if app.binderOpen}<BinderModal onclose={() => (app.binderOpen = false)} />{/if}
{#if app.backupsOpen}<BackupModal onclose={() => (app.backupsOpen = false)} />{/if}
{#if app.settingsOpen}<SettingsModal onclose={() => (app.settingsOpen = false)} />{/if}
{#if app.lightbox}<Lightbox nodeId={app.lightbox.nodeId} file={app.lightbox.file} onclose={() => (app.lightbox = null)} />{/if}
{#if app.mapEditor}<MapEditor mapId={app.mapEditor.mapId} onclose={() => (app.mapEditor = null)} />{/if}
{#if app.editor}<WorldEditor name={app.editor.name} onclose={() => (app.editor = null)} />{/if}
{#if app.toast}<div class="toast" class:ok={app.toastKind === 'ok'}>{app.toast}</div>{/if}

<style>
  .shell { position: relative; height: 100%; display: grid; grid-template-columns: var(--wl) minmax(0, 1fr) var(--wr); grid-template-rows: 46px minmax(0, 1fr) var(--hb); grid-template-areas: 'top top top' 'pool center dock' 'pool bottom dock'; }
  .top { grid-area: top; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 8px; }
  .logo { color: var(--accent); font-size: 18px; text-shadow: 0 0 14px var(--accent); }
  .tabs { display: flex; gap: 2px; margin-left: 14px; }
  .tabs button { background: transparent; border: 0; padding: 5px 12px; border-radius: 99px; color: var(--text-dim); }
  .tabs button:hover { background: var(--bg-3); color: var(--text); }
  .tabs button.on { background: var(--accent-soft); color: var(--text); box-shadow: inset 0 0 0 1px var(--accent); }
  .spacer { flex: 1; }
  .toggle { color: var(--text-dim); font-size: 12px; display: flex; gap: 5px; align-items: center; cursor: pointer; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 8px var(--danger); }
  .dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }

  :global(.pool) { grid-area: pool; }
  .split { position: absolute; z-index: 30; background: transparent; transition: background 0.15s; }
  .split.v { top: 46px; bottom: 0; width: 7px; cursor: col-resize; }
  .split.h { height: 7px; cursor: row-resize; }
  .split:hover, .split:focus-visible, .split:active { background: color-mix(in srgb, var(--accent) 55%, transparent); outline: none; }
  .center { grid-area: center; position: relative; min-height: 0; min-width: 0; }
  .bottom { grid-area: bottom; min-height: 0; display: grid; }
  .dock { grid-area: dock; display: flex; flex-direction: column; min-height: 0; background: var(--bg-2); border-left: 1px solid var(--line); }
  .dtabs { display: flex; border-bottom: 1px solid var(--line); }
  .dtabs button { flex: 1; background: transparent; border: 0; padding: 10px; color: var(--text-dim); border-bottom: 2px solid transparent; }
  .dtabs button.on { color: var(--text); border-bottom-color: var(--accent); }
  .dbody { flex: 1; overflow: auto; min-height: 0; }
  .dbody:has(:global(.chat:not(.compact))) { overflow: hidden; }
  .wc { display: inline-block; margin-left: 6px; min-width: 16px; padding: 0 5px; border-radius: 99px; background: #6a4a18; color: #ffcf70; font-size: 10.5px; line-height: 16px; }
  .busy { display: inline-block; width: 7px; height: 7px; margin-left: 7px; border-radius: 50%; background: var(--claude); box-shadow: 0 0 8px var(--claude); animation: pnp-ring 0.9s infinite; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; background: var(--bg); color: var(--text-faint); }
  .toast.ok { border-color: var(--ok); }
  .vttchip { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--line-2); border-radius: 99px; padding: 2px 10px; color: var(--text-dim); font-size: 11.5px; }
  .aimode { display: inline-flex; align-items: center; gap: 2px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 99px; padding: 2px; font-size: 11.5px; }
  .aimode .dim { color: var(--text-faint); padding: 0 6px 0 8px; }
  .aimode button { background: transparent; border: 0; color: var(--text-dim); border-radius: 99px; padding: 2px 10px; font-size: 11.5px; }
  .aimode button.on { background: var(--bg-4); color: var(--text); box-shadow: inset 0 0 0 1px var(--line-2); }
  .aimode .rc { margin-left: 5px; background: var(--agy, #b89cff); color: #0a0c11; border-radius: 99px; padding: 0 6px; font-size: 10px; }
  .searchbtn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-3); border: 1px solid var(--line-2); color: var(--text-dim); border-radius: 99px; padding: 3px 10px; font-size: 12px; }
  .searchbtn:hover { color: var(--text); border-color: var(--accent); }
  .searchbtn kbd { font: 10px var(--mono); color: var(--text-faint); border: 1px solid var(--line-2); border-radius: 4px; padding: 0 4px; }
  .qwrap { position: relative; }
  .qchip { display: inline-flex; align-items: center; gap: 7px; background: #3a2a10; border: 1px solid #6a4a18; color: #ffcf70; border-radius: 99px; padding: 3px 11px; font-size: 12px; }
  .qchip i { width: 7px; height: 7px; border-radius: 50%; background: #ffcf70; animation: pnp-q 1.2s ease-in-out infinite; }
  @keyframes pnp-q { 50% { opacity: .3; } }
  .qlist { position: absolute; right: 0; top: calc(100% + 6px); z-index: 80; width: 280px; padding: 4px; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: 0 14px 40px rgba(0,0,0,.5); display: grid; gap: 2px; }
  .qrow { display: grid; grid-template-columns: 38px 1fr auto; gap: 8px; align-items: center; text-align: left; background: transparent; border: 0; color: var(--text); padding: 6px 8px; border-radius: 6px; font-size: 12px; }
  .qrow:hover { background: var(--bg-3); }
  .qs { font-size: 11px; color: #ffcf70; } .qs.run { color: var(--accent); font-weight: 600; }
  .qt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qk { color: var(--text-faint); font-size: 11px; }
  .vttchip:hover { border-color: var(--accent); color: var(--text); }
  .vttchip i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
  .vttchip.on i { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .toast { position: fixed; bottom: 170px; left: 50%; transform: translateX(-50%); background: var(--bg-4); border: 1px solid var(--danger); color: var(--text); padding: 8px 14px; border-radius: var(--radius-s); z-index: 2000; animation: pnp-pop 0.2s ease-out; }
</style>
