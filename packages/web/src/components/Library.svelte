<script lang="ts">
  import { onMount } from 'svelte';
  import { app, say, sendChat } from '../lib/app.svelte';

  type Kind = 'rules' | 'world';
  interface Hit { id: string; title: string; trail: string[]; snippet: string; kind: Kind; score: number }
  interface Book { name: string; sections: number; chars: number; summary?: string }
  interface Lib { rules: Book[]; digest: string; world: Book[] }
  interface Sec { id: string; title: string; text: string; truncated: boolean; children: { id: string; title: string }[] }

  let lib = $state<Lib | null>(null);
  let q = $state('');
  let scope = $state<'all' | Kind>('all');
  let hits = $state<Hit[]>([]);
  let section = $state<(Sec & { kind: Kind }) | null>(null);
  let digest = $state('');
  let showDigest = $state(false);
  let paths = $state<Record<Kind, string>>({ rules: '', world: '' });
  let busy = $state('');
  let timer: ReturnType<typeof setTimeout>;

  interface Imp { name: string; chars: number; importedAt: string }
  let imports = $state<Imp[]>([]);
  let pasteOpen = $state(false);
  let pasteName = $state('');
  let pasteText = $state('');

  const refresh = async () => {
    lib = await (await fetch('/api/library')).json();
    digest = lib?.digest ?? '';
    imports = await (await fetch('/api/imports')).json();
  };
  onMount(refresh);
  // refresh after the editor closes / the AI writes a book
  $effect(() => { app.editor; app.chatStatus.busy; void refresh(); });

  function search() {
    clearTimeout(timer);
    if (!q.trim()) { hits = []; return; }
    timer = setTimeout(async () => {
      hits = await (await fetch(`/api/library/search?q=${encodeURIComponent(q)}&scope=${scope}`)).json();
    }, 200);
  }
  $effect(() => { scope; search(); });

  async function open(id: string, kind: Kind) {
    const r = await fetch(`/api/library/section?id=${encodeURIComponent(id)}&kind=${kind}`);
    if (!r.ok) return say(((await r.json()) as { error: string }).error);
    section = { ...(await r.json()), kind };
  }

  async function upload(kind: Kind, e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    busy = 'uploading…';
    const r = await fetch(`/api/library/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name, content: await f.text() }) });
    const j = await r.json();
    busy = '';
    say(r.ok ? `Loaded “${j.name}” (${j.sections} sections)` : j.error);
    e.currentTarget.value = '';
    void refresh();
  }

  async function importPath(kind: Kind) {
    if (!paths[kind].trim()) return;
    busy = 'importing…';
    const r = await fetch(`/api/library/${kind}/import-path`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: paths[kind].trim() }) });
    const j = await r.json();
    busy = '';
    if (r.ok) { say(`Loaded “${j.name}” (${j.sections} sections)`); paths[kind] = ''; } else say(j.error);
    void refresh();
  }

  async function importNotes(name: string, body: BodyInit, json = false) {
    busy = 'reading the notes…';
    try {
      const r = await fetch(`/api/imports?name=${encodeURIComponent(name)}`, { method: 'POST', headers: json ? { 'content-type': 'application/json' } : { 'content-type': 'application/octet-stream' }, body });
      const j = (await r.json()) as { ok: boolean; error?: string; name: string; chars: number };
      if (!j.ok) { say(j.error ?? 'Import failed'); return; }
      say(`Imported “${j.name}” (${j.chars >= 1000 ? `${Math.round(j.chars / 1000)}k` : j.chars} characters) — now let the AI turn it into nodes`, 'ok');
      pasteText = ''; pasteName = ''; pasteOpen = false;
    } finally {
      busy = '';
      void refresh();
    }
  }
  async function uploadNotes(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    await importNotes(f.name, await f.arrayBuffer() as ArrayBuffer);
    e.currentTarget.value = '';
  }
  const pasteNotes = () => importNotes(pasteName.trim() || 'pasted-notes', JSON.stringify({ text: pasteText }), true);
  async function removeImport(name: string) {
    await fetch(`/api/imports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    void refresh();
  }
  function turnIntoNodes(name: string) {
    app.tab = 'chat';
    void sendChat(
      `Turn my imported notes "${name}" into campaign nodes. First call get_graph (so you do not duplicate what exists), then read ALL of the notes with read_import (follow "next" until it is null). Rules: do not invent facts — if something is unclear, leave it out and mention it at the end; keep my wording in the node body; text that is clearly meant to be read aloud goes into readAloud; give each node a one-line summary. Types: places → location, people → npc, opponents → enemy, groups → faction, objects → item, secrets/clues → clue, background lore → lore, scenes/encounters/events/decisions → scene/encounter/event/decision. Put prepared material (places, NPCs, items, anything without a fixed order) into the pool (place:"pool"); put a clearly ordered sequence of scenes onto the canvas (place:"canvas", linked leads-to). Link people to their places with belongs-to, clues to what they reveal with reveals. Use ONE batch with explicit ids. Finish with 3-4 lines: what you created, and what was unclear.`,
    );
  }

  async function remove(kind: Kind, name: string) {
    if (!confirm(`Remove “${name}” from this campaign? A backup copy is kept in .bak/ for world books; the original file is untouched.`)) return;
    await fetch(`/api/library/${kind}/${encodeURIComponent(name)}`, { method: 'DELETE' });
    void refresh();
  }

  async function saveDigest() {
    await fetch('/api/library/rules-digest', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: digest }) });
    say('Digest saved');
    void refresh();
  }

  function askDigest() {
    app.tab = 'chat';
    void sendChat('Write a compact "core rules" digest of the loaded rulebook(s) (the resolution mechanic, key stats and terms, combat flow, anything a GM needs to stat NPCs and encounters — max ~1200 words, German if the rulebook is German). Use list_chapters and get_section to read the rules, then save it with set_rules_digest.');
  }

  const fmt = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/^#{1,6}\s+(.*)$/gm, '<b class="h">$1</b>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const kinds: { kind: Kind; title: string; icon: string; empty: string }[] = [
    { kind: 'rules', title: 'Rulebooks', icon: '📖', empty: 'No rulebook yet. The AI searches it (search_rules) so it doesn’t invent mechanics.' },
    { kind: 'world', title: 'World books', icon: '◍', empty: 'Lore, geography, history, factions — as much text as you like. Stable reference material; the AI sees each book’s summary + outline and searches the rest (search_world).' },
  ];
</script>

<div class="lib">
  {#if section}
    <div class="viewer">
      <button class="btn ghost back" onclick={() => (section = null)}>← back</button>
      <div class="vt"><span class="chip k-{section.kind}">{section.kind}</span> {section.title}</div>
      <pre>{@html fmt(section.text)}</pre>
      {#if section.children.length && section.truncated}
        <div class="label">Sub-sections</div>
        {#each section.children as c}<button class="link" onclick={() => open(c.id, section!.kind)}>{c.title}</button>{/each}
      {/if}
    </div>
  {:else}
    <div class="bar">
      <input class="field" placeholder="Search rules & world books…" bind:value={q} oninput={search} />
      <div class="seg">
        {#each ['all', 'rules', 'world'] as s}<button class:on={scope === s} onclick={() => (scope = s as typeof scope)}>{s}</button>{/each}
      </div>
    </div>

    {#if q.trim()}
      <div class="hits">
        {#each hits as h (h.kind + h.id)}
          <button class="hit" onclick={() => open(h.id, h.kind)}>
            <div class="ht"><span class="chip k-{h.kind}">{h.kind}</span> {h.trail.join(' › ') || h.title}</div>
            <div class="sn">{h.snippet}</div>
          </button>
        {:else}
          <div class="empty">No matches.</div>
        {/each}
      </div>
    {:else}
      {#each kinds as k}
        <div class="sect">
          <div class="head">
            <div class="label">{k.title}</div>
            {#if k.kind === 'world'}<button class="btn primary sm" onclick={() => (app.editor = { name: null })}>＋ New</button>{/if}
          </div>
          {#each lib?.[k.kind] ?? [] as b (b.name)}
            <div class="book">
              <div class="row">
                <span class="nm">{k.icon} <b>{b.name}</b></span>
                <span class="dim">{b.sections} sections · {b.chars >= 1000 ? `${Math.round(b.chars / 1000)}k` : b.chars}</span>
                {#if k.kind === 'world'}<button class="btn sm" onclick={() => (app.editor = { name: b.name })}>Edit</button>{/if}
                <button class="btn ghost sm" title="Remove" onclick={() => remove(k.kind, b.name)}>×</button>
              </div>
              {#if k.kind === 'world'}
                <div class="sum" class:none={!b.summary}>{b.summary || 'No summary yet — the AI sees only the outline. Open the editor to add one.'}</div>
              {/if}
            </div>
          {:else}
            <p class="dim">{k.empty}</p>
          {/each}
          <div class="add">
            <label class="btn sm">Upload .md<input type="file" accept=".md,.markdown,.txt" onchange={(e) => upload(k.kind, e)} hidden /></label>
            <input class="field" placeholder="…or a path, e.g. ~/lore/world.md" bind:value={paths[k.kind]} onkeydown={(e) => e.key === 'Enter' && importPath(k.kind)} />
            <button class="btn sm" onclick={() => importPath(k.kind)} disabled={!paths[k.kind].trim()}>Import</button>
          </div>

          {#if k.kind === 'rules' && lib?.rules.length}
            <div class="label">Core rules digest <span class="dim">(always in the AI's context)</span></div>
            {#if showDigest}
              <textarea class="field tall" bind:value={digest} placeholder="Short cheat sheet of the core mechanics…"></textarea>
              <div class="acts"><button class="btn primary sm" onclick={saveDigest}>Save</button><button class="btn sm" onclick={askDigest}>✦ Ask the AI to write it</button><button class="btn ghost sm" onclick={() => (showDigest = false)}>close</button></div>
            {:else}
              <div class="acts">
                <button class="btn sm" onclick={() => (showDigest = true)}>{lib.digest ? `Edit digest (${lib.digest.length} chars)` : 'Add digest'}</button>
                {#if !lib.digest}<button class="btn sm" onclick={askDigest}>✦ Ask the AI</button>{/if}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
      <div class="sect">
        <div class="head"><div class="label">Import notes</div></div>
        <p class="dim">Your existing prep (.md, .txt, .docx, .pdf or pasted text). The AI reads it and creates typed nodes — nothing is created without you pressing the button.</p>
        {#each imports as im (im.name)}
          <div class="book">
            <div class="row">
              <span class="nm">📝 <b>{im.name}</b></span>
              <span class="dim">{im.chars >= 1000 ? `${Math.round(im.chars / 1000)}k` : im.chars} chars</span>
              <button class="btn primary sm" disabled={app.chatStatus.busy} onclick={() => turnIntoNodes(im.name)} title="The AI reads the notes and creates nodes">✦ Turn into nodes</button>
              <button class="btn ghost sm" title="Remove the imported text (nodes already created stay)" onclick={() => removeImport(im.name)}>×</button>
            </div>
          </div>
        {/each}
        <div class="add">
          <label class="btn sm">Choose file<input type="file" accept=".md,.markdown,.txt,.docx,.pdf" onchange={uploadNotes} hidden /></label>
          <button class="btn sm" onclick={() => (pasteOpen = !pasteOpen)}>{pasteOpen ? 'Cancel' : 'Paste text'}</button>
        </div>
        {#if pasteOpen}
          <input class="field" placeholder="Name (e.g. session 3 prep)" bind:value={pasteName} />
          <textarea class="field tall" placeholder="Paste your notes here…" bind:value={pasteText}></textarea>
          <div class="acts"><button class="btn primary sm" disabled={!pasteText.trim()} onclick={pasteNotes}>Import</button></div>
        {/if}
      </div>
      {#if busy}<div class="dim">{busy}</div>{/if}
    {/if}
  {/if}
</div>

<style>
  .lib { padding: 10px 12px 40px; }
  .bar { display: grid; gap: 8px; position: sticky; top: 0; background: var(--bg-2); padding-bottom: 8px; z-index: 1; }
  .seg { display: flex; gap: 4px; }
  .seg button { flex: 1; background: transparent; border: 1px solid var(--line); color: var(--text-dim); border-radius: 99px; padding: 2px 0; font-size: 11px; text-transform: capitalize; }
  .seg button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  .hits { display: grid; gap: 6px; }
  .hit { text-align: left; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: var(--radius-s); padding: 7px 10px; }
  .hit:hover { border-color: var(--accent); }
  .ht { font-weight: 600; }
  .sn { color: var(--text-dim); font-size: 12px; margin-top: 3px; }
  .chip.k-rules { color: #c9b3ff; border-color: #4a3d73; }
  .chip.k-world { color: #7be3d7; border-color: #2c5e58; }
  .sect { margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head .label { margin: 8px 0 4px; }
  .sm { padding: 2px 9px; font-size: 12px; }
  .book { padding: 5px 0; }
  .row { display: flex; align-items: center; gap: 8px; }
  .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sum { margin: 3px 0 2px 22px; color: var(--text-dim); font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .sum.none { color: #e0c36a; font-style: italic; }
  .dim { color: var(--text-faint); font-size: 12px; }
  p.dim { margin: 4px 0; line-height: 1.5; }
  .add { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; margin-top: 8px; align-items: center; }
  .tall { min-height: 200px; font-family: var(--mono); font-size: 12px; }
  .acts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .link { background: transparent; border: 0; color: var(--accent); padding: 2px 0; text-align: left; }
  .link:hover { text-decoration: underline; }
  .empty { color: var(--text-faint); text-align: center; padding: 20px; }
  .vt { font-weight: 600; margin: 6px 0 10px; }
  .viewer pre { white-space: pre-wrap; font: 12.5px/1.6 var(--font); margin: 0; }
  .viewer :global(b.h) { display: block; margin-top: 10px; color: var(--text); font-size: 13.5px; }
</style>
