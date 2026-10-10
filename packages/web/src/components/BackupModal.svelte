<script lang="ts">
  // Backups & sync of the open campaign: snapshots (restore / download), automatic ones, a mirror folder, one-file export, git.
  import { onMount } from 'svelte';
  import type { BackupSettings, SnapshotInfo } from '@pnp/shared';
  import { app, say } from '../lib/app.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface Git { enabled: boolean; repo: boolean; commits: number; last: string; remotes: string[] }
  interface State { settings: BackupSettings; snapshots: SnapshotInfo[]; git: Git; folder: string; lastChange: string }

  let st = $state<State | null>(null);
  let busy = $state('');
  let label = $state('');
  let withImages = $state(true);
  let confirmRestore = $state('');
  let mirror = $state('');
  let msg = $state('');

  async function api<T = unknown>(url: string, init?: RequestInit): Promise<(T & { ok: boolean; error?: string }) | null> {
    try {
      const r = await fetch(url, init);
      const j = (await r.json()) as T & { ok: boolean; error?: string };
      if (!j.ok) { say(j.error ?? 'Failed'); return null; }
      return j;
    } catch {
      say('The server did not answer');
      return null;
    }
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const apply = (j: State | null) => { if (j) { st = j; mirror = j.settings.mirrorDir; } };

  onMount(async () => apply(await api<State>('/api/backups')));

  async function snapshot() {
    busy = 'Saving the snapshot…';
    const j = await api<State>('/api/backups', json('POST', { label, images: withImages }));
    busy = '';
    if (j) { apply(j); label = ''; msg = 'Snapshot saved.'; }
  }
  async function remove(id: string) {
    apply(await api<State>(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }
  async function restore(id: string) {
    busy = 'Restoring…';
    const j = await api<{ safety: SnapshotInfo }>(`/api/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    busy = '';
    confirmRestore = '';
    if (j) { say('Restored. The state before is saved as a “pre-restore” snapshot.', 'ok'); onclose(); }
  }
  async function saveSettings(patch: Partial<BackupSettings>) {
    apply(await api<State>('/api/backups/settings', json('PUT', patch)));
  }
  async function commit() {
    const j = await api<State & { committed: boolean; note: string }>('/api/backups/git-commit', json('POST', { message: 'Manual commit' }));
    if (j) { apply(j); msg = j.committed ? 'Committed.' : `Nothing committed (${j.note}).`; }
  }
  async function exportFile() {
    const j = await api<{ url: string; file: string }>('/api/backups/export', { method: 'POST' });
    if (j) { window.open(j.url, '_blank'); say(`Saved ${j.file} in the exports folder`, 'ok'); }
  }
  async function importFile(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    busy = 'Opening the campaign file…';
    const j = await api(`/api/backups/import?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await f.arrayBuffer() });
    busy = '';
    e.currentTarget.value = '';
    if (j) { say('Opened as a new campaign', 'ok'); onclose(); }
  }

  const ago = (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);
  const unsaved = $derived(st ? (!st.snapshots[0] || new Date(st.lastChange) > new Date(st.snapshots.filter((s) => s.kind !== 'pre-restore')[0]?.createdAt ?? 0)) : false);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" data-tour="backup-modal" role="dialog" aria-label="Backups and sync">
    <header>
      <b>Backups &amp; sync</b><span class="camp">{app.meta.name}</span>
      <span class="status">{busy || msg}</span>
      <span class="grow"></span>
      <button class="btn" onclick={onclose}>Done</button>
    </header>

    {#if st}
      <div class="body">
        <section class="main">
          <h4>Snapshots {#if unsaved}<span class="chip warn" title="Something changed since the last snapshot">changes not saved yet</span>{:else}<span class="chip good">up to date</span>{/if}</h4>
          <div class="make">
            <input class="field" placeholder="Label (optional) — e.g. before the heist" bind:value={label} onkeydown={(e) => e.key === 'Enter' && snapshot()} />
            <label class="chk" title="Light snapshots leave images out (they rarely change and stay on restore)"><input type="checkbox" bind:checked={withImages} /> with images</label>
            <button class="btn primary" disabled={!!busy} onclick={snapshot}>＋ Snapshot now</button>
          </div>
          <div class="list">
            {#each st.snapshots as s (s.id)}
              <div class="snap">
                <span class="kind k-{s.kind}">{s.kind === 'pre-restore' ? 'before restore' : s.kind}</span>
                <span class="when" title={new Date(s.createdAt).toLocaleString()}>{ago(s.createdAt)}</span>
                <span class="lbl">{s.label}</span>
                <span class="dim">{size(s.bytes)}{s.withImages ? ' · images' : ''}</span>
                {#if confirmRestore === s.id}
                  <button class="btn danger sm" disabled={!!busy} onclick={() => restore(s.id)}>Yes, restore</button>
                  <button class="btn ghost sm" onclick={() => (confirmRestore = '')}>No</button>
                {:else}
                  <button class="btn sm" disabled={!!busy} onclick={() => (confirmRestore = s.id)} title="Put this state back (your current state is saved first)">Restore</button>
                  <a class="btn ghost sm" href={`/api/backups/${encodeURIComponent(s.id)}/file`} title="Download this snapshot">⬇</a>
                  <button class="btn ghost sm" title="Delete this snapshot" onclick={() => remove(s.id)}>×</button>
                {/if}
              </div>
            {:else}
              <p class="hint">No snapshots yet. Automatic ones start while you work; press “Snapshot now” before something risky.</p>
            {/each}
          </div>
        </section>

        <section>
          <h4>Automatic snapshots</h4>
          <label class="chk"><input type="checkbox" checked={st.settings.auto} onchange={(e) => saveSettings({ auto: e.currentTarget.checked })} /> take snapshots while I work <span class="dim">(only when something changed)</span></label>
          <div class="two">
            <div><div class="label">Every (minutes)</div><input class="field" type="number" min="5" max="1440" value={st.settings.everyMinutes} onchange={(e) => saveSettings({ everyMinutes: Number(e.currentTarget.value) })} /></div>
            <div><div class="label">Keep the newest</div><input class="field" type="number" min="1" max="200" value={st.settings.keepAuto} onchange={(e) => saveSettings({ keepAuto: Number(e.currentTarget.value) })} /></div>
          </div>
          <p class="hint">Automatic snapshots are light (no images) and the oldest are removed. Snapshots you take yourself are never removed automatically. Leaving the campaign also saves it if it changed.</p>
        </section>

        <section>
          <h4>Sync to a folder</h4>
          <p class="hint">Every snapshot is also copied into this folder — point it at Dropbox, Syncthing, a network drive or a USB stick and your other machines see it.</p>
          <div class="row">
            <input class="field" placeholder="/home/you/Dropbox/pennodepaper-backups" bind:value={mirror} onkeydown={(e) => e.key === 'Enter' && saveSettings({ mirrorDir: mirror })} />
            <button class="btn" onclick={() => saveSettings({ mirrorDir: mirror })} disabled={mirror === st.settings.mirrorDir}>Save</button>
          </div>
          <h4>Move to another machine</h4>
          <div class="row">
            <button class="btn" onclick={exportFile}>⬇ Export the whole campaign as one file</button>
            <label class="btn">Open a campaign file…<input type="file" accept=".gz,.tgz,.tar.gz" onchange={importFile} hidden /></label>
          </div>
          <p class="hint">The file (.pnp.tar.gz) includes images. Opening one creates a new campaign next to the others.</p>
        </section>

        <section class="main">
          <h4>Git <span class="dim">(optional, local)</span></h4>
          <label class="chk"><input type="checkbox" checked={st.settings.git} onchange={(e) => saveSettings({ git: e.currentTarget.checked })} /> commit the campaign to a git repository with every snapshot</label>
          {#if st.git.repo}
            <p class="hint">{st.git.commits} commit{st.git.commits === 1 ? '' : 's'}{st.git.last ? ` · last: ${st.git.last}` : ''}{st.git.remotes.length ? ` · remotes: ${st.git.remotes.join(', ')}` : ' · no remote yet'}</p>
            <button class="btn" onclick={commit}>Commit now</button>
          {/if}
          <p class="hint">Pushing is up to you — PenNodePaper never sends anything anywhere. To sync through a git server: <code>cd {st.folder}</code>, then <code>git remote add origin &lt;url&gt;</code> and <code>git push -u origin HEAD</code>. Snapshots and exports are not committed.</p>
        </section>
      </div>
    {:else}
      <div class="body"><p class="hint">loading…</p></div>
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(5, 6, 9, 0.72); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(920px, 94vw); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .camp { color: var(--text-faint); }
  .grow { flex: 1; }
  .status { font-size: 11.5px; color: var(--text-faint); }
  .body { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 26px; padding: 6px 18px 20px; overflow: auto; align-items: start; }
  section.main { grid-column: 1 / -1; }
  h4 { margin: 16px 0 6px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .dim { color: var(--text-faint); font-weight: 400; font-size: 11.5px; }
  .hint { color: var(--text-faint); font-size: 11.5px; line-height: 1.5; margin: 6px 0; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
  .make { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .make .field { flex: 1; min-width: 0; }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); white-space: nowrap; }
  .list { display: grid; gap: 2px; max-height: 260px; overflow: auto; }
  .snap { display: grid; grid-template-columns: 96px 84px 1fr auto auto auto auto; gap: 8px; align-items: center; padding: 5px 8px; background: var(--bg-3); border-radius: 6px; font-size: 12px; }
  .kind { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim); }
  .k-manual { color: var(--accent); } .k-pre-restore { color: #ffcf70; }
  .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); }
  .sm { padding: 1px 8px; font-size: 11.5px; }
  a.btn { text-decoration: none; display: inline-flex; align-items: center; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row .field { flex: 1; min-width: 0; }
  .chip.warn { background: #3a2a10; color: #ffcf70; border-color: #6a4a18; }
  .chip.good { background: #12301f; color: var(--ok); border-color: #2c5a3e; }
</style>
