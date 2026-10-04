<script lang="ts">
  // The campaign name in the top bar: open another campaign, start a new one, jump back to a recent one.
  import { app, say } from '../lib/app.svelte';

  interface Info { dir: string; name: string; modifiedAt: string; nodes: number; current?: boolean; openedAt?: string }
  interface List { current: Info; recent: Info[]; all: Info[]; campaignsDir: string }

  let open = $state(false);
  let list = $state<List | null>(null);
  let newName = $state('');
  let folder = $state('');
  let mode = $state<'' | 'new' | 'folder' | 'branch'>('');
  let branchName = $state('');
  let busy = $state(false);
  let filter = $state('');

  async function toggle() {
    open = !open;
    if (!open) return;
    mode = '';
    filter = '';
    try {
      list = await (await fetch('/api/campaigns')).json();
    } catch {
      say('Could not load the campaign list');
    }
  }

  async function post(url: string, body: Record<string, unknown>): Promise<boolean> {
    busy = true;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) { say(j.error ?? 'Could not switch campaigns'); return false; }
      return true;
    } catch {
      say('The server did not answer');
      return false;
    } finally {
      busy = false;
    }
  }
  async function openDir(dir: string, current?: boolean) {
    if (current) { open = false; return; }
    if (await post('/api/campaigns/open', { dir })) open = false;
  }
  async function create() {
    if (!newName.trim()) return;
    if (await post('/api/campaigns/create', { name: newName.trim(), language: app.meta.language })) { open = false; newName = ''; }
  }
  async function branch() {
    if (!branchName.trim()) return;
    if (await post('/api/campaigns/branch', { name: branchName.trim() })) { open = false; branchName = ''; say('Branched — you are in the copy now; the original is in the list above', 'ok'); }
  }
  async function openFolder() {
    if (!folder.trim()) return;
    if (await post('/api/campaigns/open', { dir: folder.trim() })) { open = false; folder = ''; }
  }

  const ago = (iso?: string) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const shown = $derived((list?.all ?? []).filter((c) => !filter.trim() || c.name.toLowerCase().includes(filter.trim().toLowerCase())));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="cm">
  <button class="camp" class:on={open} onclick={toggle} title="Switch, open or create a campaign">{app.meta.name} <span class="car">▾</span></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="ctx-scrim" onclick={() => (open = false)}></div>
    <div class="pop cmenu-pop" role="menu">
      {#if list}
        <div class="sect">Now open</div>
        <div class="cur"><b>{list.current.name}</b><span class="dim">{list.current.nodes} nodes</span></div>

        {#if list.recent.length}
          <div class="sect">Recently used</div>
          {#each list.recent as c (c.dir)}
            <button class="row" disabled={busy} onclick={() => openDir(c.dir)} title={c.dir}>
              <span class="t">{c.name}</span><span class="dim">{ago(c.openedAt)}</span>
            </button>
          {/each}
        {/if}

        <div class="sect">All campaigns <span class="dim">in {list.campaignsDir.split('/').slice(-2).join('/')}</span></div>
        {#if list.all.length > 6}<input class="field" placeholder="Filter…" bind:value={filter} />{/if}
        <div class="all">
          {#each shown as c (c.dir)}
            <button class="row" class:cur2={c.current} disabled={busy} onclick={() => openDir(c.dir, c.current)} title={c.dir}>
              <span class="t">{c.name}{#if c.current} <span class="dim">· open</span>{/if}</span><span class="dim">{c.nodes} nodes · {ago(c.modifiedAt)}</span>
            </button>
          {:else}
            <div class="dim pad">No other campaigns here yet.</div>
          {/each}
        </div>

        <div class="sep"></div>
        {#if mode === 'new'}
          <div class="form">
            <input class="field" placeholder="Name of the new campaign" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && create()} />
            <button class="btn primary" disabled={busy || !newName.trim()} onclick={create}>Create</button>
          </div>
        {:else if mode === 'branch'}
          <div class="form">
            <input class="field" placeholder="Name of the “what if” copy" bind:value={branchName} onkeydown={(e) => e.key === 'Enter' && branch()} />
            <button class="btn primary" disabled={busy || !branchName.trim()} onclick={branch}>Branch</button>
          </div>
          <div class="dim pad">A full copy (images included) to try another storyline in. The original stays untouched.</div>
        {:else if mode === 'folder'}
          <div class="form">
            <input class="field" placeholder="/path/to/campaign-folder" bind:value={folder} onkeydown={(e) => e.key === 'Enter' && openFolder()} />
            <button class="btn primary" disabled={busy || !folder.trim()} onclick={openFolder}>Open</button>
          </div>
        {:else}
          <button class="item" onclick={() => (mode = 'new')}>＋ New campaign…</button>
          <button class="item" onclick={() => { branchName = `${app.meta.name} – what if`; mode = 'branch'; }}>⑂ Branch this campaign…</button>
          <button class="item" onclick={() => (mode = 'folder')}>📂 Open a campaign folder…</button>
          <button class="item" onclick={() => { open = false; app.binderOpen = true; }}>📘 GM binder (PDF)…</button>
          <button class="item" onclick={() => { open = false; app.backupsOpen = true; }}>🛟 Backups &amp; sync…</button>
        {/if}
      {:else}
        <div class="dim pad">loading…</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cm { position: relative; }
  .camp { background: transparent; border: 0; border-left: 1px solid var(--line-2); color: var(--text-dim); padding: 3px 8px 3px 10px; margin-left: 8px; border-radius: 0 6px 6px 0; font-size: 13px; }
  .camp:hover, .camp.on { color: var(--text); background: var(--bg-3); }
  .car { font-size: 10px; color: var(--text-faint); }
  .pop { position: absolute; left: 6px; top: calc(100% + 8px); z-index: 91; width: 340px; max-height: calc(100vh - 80px); overflow: auto; padding: 6px; background: color-mix(in srgb, var(--bg-2) 96%, transparent); backdrop-filter: blur(14px); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: 0 18px 50px rgba(0, 0, 0, .55); display: grid; gap: 2px; }
  .sect { padding: 8px 8px 2px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); }
  .cur { display: flex; justify-content: space-between; padding: 4px 10px 6px; font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; text-align: left; background: transparent; border: 0; color: var(--text); padding: 6px 10px; border-radius: var(--radius-s); font-size: 12.5px; width: 100%; }
  .row:hover:not(:disabled) { background: var(--bg-3); }
  .row.cur2 { background: var(--bg-3); }
  .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dim { color: var(--text-faint); font-size: 11px; white-space: nowrap; }
  .pad { padding: 6px 10px; }
  .all { display: grid; gap: 1px; max-height: 220px; overflow: auto; }
  .sep { height: 1px; background: var(--line); margin: 6px 0 2px; }
  .item { text-align: left; background: transparent; border: 0; color: var(--text); padding: 7px 10px; border-radius: var(--radius-s); font-size: 12.5px; }
  .item:hover { background: var(--bg-3); }
  .form { display: flex; gap: 6px; padding: 4px; }
  .form .field { flex: 1; min-width: 0; }
</style>
