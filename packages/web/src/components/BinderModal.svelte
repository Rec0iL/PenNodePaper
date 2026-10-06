<script lang="ts">
  // The GM binder: pick what goes in, get one printable PDF — and, if you like, the pages to hand out and lay on the table.
  import { onMount } from 'svelte';
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
  type Prints = { handouts: number; maps: number; places: number; pages: number };
  let result = $state<{ url: string; file: string; mb: number; prints?: Prints } | null>(null);

  // table prints: what to hand out, how many copies of each kind
  let mode = $state<'binder' | 'both' | 'prints'>('binder');
  let copies = $state({ handouts: 1, maps: 1, places: 1 });
  const MAX = 30;
  const clamp = (n: number) => Math.max(0, Math.min(MAX, Math.floor(Number.isFinite(n) ? n : 0)));
  const nHandouts = $derived(Object.values(app.nodes).filter((n) => n.type === 'handout' && !n.trashed).length);
  const nPlacePics = $derived(Object.values(app.nodes).filter((n) => n.type === 'location' && !n.trashed).reduce((a, n) => a + n.images.length, 0));
  let nMaps = $state<number | null>(null);
  onMount(async () => {
    try { nMaps = ((await (await fetch('/api/maps')).json()) as unknown[]).length; } catch { nMaps = null; }
  });
  const wantsPrints = $derived(mode !== 'binder');

  const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function make() {
    busy = true;
    result = null;
    const r = await cmd<{ url: string; file: string; mb: number; prints?: Prints }>('export_binder', { sections: picked, notes, images, mode, copies: wantsPrints ? { handouts: clamp(copies.handouts), maps: clamp(copies.maps), places: clamp(copies.places) } : undefined });
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
      <div class="modes" role="radiogroup" aria-label="What to print">
        <label class:on={mode === 'binder'}><input type="radio" bind:group={mode} value="binder" /> <b>Binder</b><span class="dim">the GM binder only</span></label>
        <label class:on={mode === 'both'}><input type="radio" bind:group={mode} value="both" /> <b>Binder + table prints</b><span class="dim">the prints follow at the end</span></label>
        <label class:on={mode === 'prints'}><input type="radio" bind:group={mode} value="prints" /> <b>Table prints only</b><span class="dim">just the pages to hand out</span></label>
      </div>
      {#if wantsPrints}
        <div class="prints">
          <div class="ph">Table prints <span class="dim">each one on a page of its own (portrait or landscape by its shape), the copies one after the other — to hand out, cut up or lay on the table. 0 = leave out.</span></div>
          <label class="crow"><span>Handouts <i class="dim">{nHandouts} found</i></span><input type="number" min="0" max={MAX} step="1" bind:value={copies.handouts} /><span class="dim">copies each</span></label>
          <label class="crow"><span>Battle &amp; region maps <i class="dim">{nMaps ?? '?'} found</i></span><input type="number" min="0" max={MAX} step="1" bind:value={copies.maps} /><span class="dim">copies each</span></label>
          <label class="crow"><span>Place pictures <i class="dim">{nPlacePics} found</i></span><input type="number" min="0" max={MAX} step="1" bind:value={copies.places} /><span class="dim">copies each</span></label>
        </div>
      {/if}
      <div class="list" class:off={mode === 'prints'}>
        {#each SECTIONS as s (s.id)}
          <label class="row"><input type="checkbox" disabled={mode === 'prints'} checked={picked.includes(s.id)} onchange={() => toggle(s.id)} /> <b>{s.label}</b>{#if s.hint}<span class="dim">{s.hint}</span>{/if}</label>
        {/each}
      </div>
      <label class="row"><input type="checkbox" bind:checked={notes} /> <b>Include my GM notes</b><span class="dim">off = only read-aloud and summaries (e.g. for a co-GM)</span></label>
      <label class="row"><input type="checkbox" bind:checked={images} /> <b>Include pictures and maps</b><span class="dim">off = much smaller file</span></label>
      <div class="acts">
        <button class="btn primary" disabled={busy || (mode === 'prints' ? !(copies.handouts || copies.maps || copies.places) : !picked.length)} onclick={make}>{busy ? 'Making the PDF… (10–20 s)' : mode === 'prints' ? '🖨 Make the table prints' : '📘 Make the PDF'}</button>
        {#if result}<a class="btn" href={result.url} target="_blank" rel="noreferrer">⬇ {result.file} · {result.mb < 0.1 ? '<0.1' : result.mb} MB</a>{/if}
      </div>
      {#if result?.prints}<p class="hint">Table prints: {result.prints.pages} page{result.prints.pages === 1 ? '' : 's'} — {result.prints.handouts} handout{result.prints.handouts === 1 ? '' : 's'}, {result.prints.maps} map{result.prints.maps === 1 ? '' : 's'}, {result.prints.places} place picture{result.prints.places === 1 ? '' : 's'}.</p>{/if}
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
  .modes { display: grid; gap: 4px; margin: 2px 0 6px; }
  .modes label { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 6px 10px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg-3); cursor: pointer; }
  .modes label.on { border-color: var(--accent); background: var(--bg-4); }
  .prints { display: grid; gap: 6px; padding: 10px 12px; margin-bottom: 6px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 10px; }
  .ph { font-size: 12.5px; font-weight: 600; } .ph .dim { display: block; font-weight: 400; margin-top: 2px; line-height: 1.45; }
  .crow { display: grid; grid-template-columns: 1fr 64px auto; gap: 8px; align-items: center; font-size: 13px; }
  .crow input { width: 64px; padding: 4px 6px; text-align: center; background: var(--bg); border: 1px solid var(--line-2); border-radius: 6px; color: var(--text); }
  .list.off { opacity: 0.4; }
  .list { display: grid; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .row { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 2px 0; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .acts { display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  a.btn { text-decoration: none; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
</style>
