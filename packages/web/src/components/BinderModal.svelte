<script lang="ts">
  // The GM binder: pick what goes in, get one printable PDF.
  import { app, cmd, say } from '../lib/app.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const SECTIONS = [
    { id: 'map', label: 'Story map', hint: 'the canvas as one picture' },
    { id: 'story', label: 'The story', hint: 'beat by beat: read-aloud box, GM notes, where it leads' },
    { id: 'pool', label: 'Prepared material', hint: 'scenes you have not placed yet' },
    { id: 'places', label: 'Places', hint: 'with their maps' },
    { id: 'people', label: 'People & opponents', hint: 'with character sheets' },
    { id: 'things', label: 'Things, lore & secrets', hint: '' },
    { id: 'handouts', label: 'Handouts', hint: 'one per page, to print and cut out' },
    { id: 'tables', label: 'Random tables', hint: '' },
    { id: 'party', label: 'The party', hint: '' },
  ] as const;

  let picked = $state<string[]>(SECTIONS.map((s) => s.id));
  let notes = $state(true);
  let images = $state(true);
  let busy = $state(false);
  let result = $state<{ url: string; file: string; mb: number } | null>(null);

  const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function make() {
    busy = true;
    result = null;
    const r = await cmd<{ url: string; file: string; mb: number }>('export_binder', { sections: picked, notes, images });
    busy = false;
    if (r) {
      result = r;
      window.open(r.url, '_blank');
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && onclose()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && !busy && onclose()}>
  <div class="modal" role="dialog" aria-label="GM binder">
    <header><b>GM binder</b><span class="camp">{app.meta.name}</span><span class="grow"></span><button class="btn" disabled={busy} onclick={onclose}>Close</button></header>
    <div class="body">
      <p class="hint">The whole campaign as one printable PDF (A4): cover, contents, story map, and the parts you pick. It reads your nodes as they are now.</p>
      <div class="list">
        {#each SECTIONS as s (s.id)}
          <label class="row"><input type="checkbox" checked={picked.includes(s.id)} onchange={() => toggle(s.id)} /> <b>{s.label}</b>{#if s.hint}<span class="dim">{s.hint}</span>{/if}</label>
        {/each}
      </div>
      <label class="row"><input type="checkbox" bind:checked={notes} /> <b>Include my GM notes</b><span class="dim">off = only read-aloud and summaries (e.g. for a co-GM)</span></label>
      <label class="row"><input type="checkbox" bind:checked={images} /> <b>Include pictures and maps</b><span class="dim">off = much smaller file</span></label>
      <div class="acts">
        <button class="btn primary" disabled={busy || !picked.length} onclick={make}>{busy ? 'Making the PDF… (10–20 s)' : '📘 Make the PDF'}</button>
        {#if result}<a class="btn" href={result.url} target="_blank" rel="noreferrer">⬇ {result.file} · {result.mb < 0.1 ? '<0.1' : result.mb} MB</a>{/if}
      </div>
      {#if result}<p class="hint">Saved in the campaign's <code>exports</code> folder too.</p>{/if}
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(5, 6, 9, 0.72); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(560px, 94vw); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .camp { color: var(--text-faint); } .grow { flex: 1; }
  .body { padding: 14px 18px 20px; overflow: auto; display: grid; gap: 8px; }
  .hint { color: var(--text-faint); font-size: 12px; line-height: 1.5; margin: 0 0 4px; }
  .list { display: grid; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .row { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 2px 0; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .acts { display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  a.btn { text-decoration: none; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
</style>
