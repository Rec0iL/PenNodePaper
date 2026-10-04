<script lang="ts">
  // A small, roomy markdown editor for world books (stable lore documents in the Library).
  import { onMount } from 'svelte';
  import { app, say, sendChat } from '../lib/app.svelte';

  let { name: initial, onclose }: { name: string | null; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let isNew = $state(initial === null); // flips to false after the first save: the name is then locked
  // svelte-ignore state_referenced_locally
  let name = $state(initial ?? '');
  let text = $state('');
  let savedText = $state('');
  let summary = $state('');
  let savedSummary = $state('');
  let aiOutline = $state('');
  // svelte-ignore state_referenced_locally
  let loading = $state(initial !== null);
  let saving = $state(false);
  let savedAt = $state<number | null>(null);
  let failed = $state(false);
  let ta = $state<HTMLTextAreaElement | null>(null);

  const dirty = $derived(text !== savedText || summary !== savedSummary);
  const ready = $derived(!!name.trim() && !!text.trim());
  const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
  const sumLen = $derived(summary.trim().length);
  const sumState = $derived(sumLen === 0 ? 'none' : sumLen < 300 ? 'short' : sumLen > 600 ? 'long' : 'ok');

  async function load() {
    if (initial === null) return;
    const r = await fetch(`/api/library/world/${encodeURIComponent(initial)}`);
    if (r.ok) {
      const j = await r.json();
      text = savedText = j.text;
      summary = savedSummary = j.summary;
      aiOutline = j.outline;
    } else say('Could not load the book');
    loading = false;
    ta?.focus();
  }

  onMount(() => {
    void load();
    ta?.focus();
    return () => clearTimeout(saveTimer);
  });

  // ---- outline (debounced so huge texts stay snappy) --------------------------------
  interface Heading { level: number; title: string; offset: number }
  let headings = $state<Heading[]>([]);
  let timer: ReturnType<typeof setTimeout>;
  function parse(t: string): Heading[] {
    const out: Heading[] = [];
    let fence = false;
    let off = 0;
    for (const line of t.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      else if (!fence) {
        const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (m) out.push({ level: m[1].length, title: m[2], offset: off });
      }
      off += line.length + 1;
    }
    return out;
  }
  $effect(() => {
    const t = text;
    clearTimeout(timer);
    timer = setTimeout(() => (headings = parse(t)), 200);
  });

  function jump(h: Heading) {
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(h.offset, h.offset + h.title.length + h.level + 1);
    // scroll the heading near the top: measure by temporarily truncating to the offset
    const probe = document.createElement('div');
    const cs = getComputedStyle(ta);
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;width:${ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px;font:${cs.font};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing}`;
    probe.textContent = text.slice(0, h.offset) + '​';
    document.body.appendChild(probe);
    ta.scrollTop = Math.max(0, probe.offsetHeight - 40);
    probe.remove();
  }

  // ---- editing helpers --------------------------------------------------------------
  function edit(fn: (v: string, a: number, b: number) => { v: string; a: number; b: number }) {
    if (!ta) return;
    const { v, a, b } = fn(text, ta.selectionStart, ta.selectionEnd);
    text = v;
    queueMicrotask(() => {
      ta?.focus();
      ta?.setSelectionRange(a, b);
    });
  }
  const prefixLine = (p: string) =>
    edit((v, a, b) => {
      const start = v.lastIndexOf('\n', a - 1) + 1;
      const line = v.slice(start).split('\n')[0];
      const stripped = line.replace(/^#{1,6}\s+/, '');
      const had = line.startsWith(p);
      const next = had ? stripped : p + stripped;
      return { v: v.slice(0, start) + next + v.slice(start + line.length), a: a + (next.length - line.length), b: b + (next.length - line.length) };
    });
  const wrap = (m: string) =>
    edit((v, a, b) => ({ v: v.slice(0, a) + m + (v.slice(a, b) || 'text') + m + v.slice(b), a: a + m.length, b: (b === a ? a + 4 : b) + m.length }));
  const bullet = () =>
    edit((v, a, b) => {
      const start = v.lastIndexOf('\n', a - 1) + 1;
      return { v: v.slice(0, start) + '- ' + v.slice(start), a: a + 2, b: b + 2 };
    });

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      edit((v, a, b) => ({ v: v.slice(0, a) + '  ' + v.slice(b), a: a + 2, b: a + 2 }));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**');
    }
  }

  // ---- autosave ---------------------------------------------------------------------
  let saveTimer: ReturnType<typeof setTimeout>;
  let inflight: Promise<void> | null = null;

  $effect(() => {
    // watch everything that can change; (re)start the debounce
    text; summary; name;
    clearTimeout(saveTimer);
    if (!loading && dirty && ready) saveTimer = setTimeout(() => void save(), 900);
  });

  async function save() {
    if (inflight) await inflight;
    if (!dirty || !ready) return;
    const snap = { text, summary, name: name.trim() };
    saving = true;
    failed = false;
    inflight = (async () => {
      try {
        const r = await fetch('/api/library/world', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: snap.name, content: snap.text, summary: snap.summary, autosave: true }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Save failed');
        // mark exactly what was saved (the user may have typed more meanwhile)
        savedText = snap.text;
        savedSummary = snap.summary;
        if (isNew) {
          isNew = false;
          name = j.name; // server-normalised name; now locked
        }
        savedAt = Date.now();
        const o = await fetch(`/api/library/world/${encodeURIComponent(j.name)}`);
        if (o.ok) aiOutline = (await o.json()).outline;
      } catch (e) {
        failed = true;
        say(e instanceof Error ? e.message : 'Save failed');
      } finally {
        saving = false;
      }
    })();
    await inflight;
    inflight = null;
  }

  async function close() {
    clearTimeout(saveTimer);
    if (dirty && ready) await save();
    if (dirty && !failed && !ready && !confirm('This book has no name or text yet — discard it?')) return;
    if (failed && !confirm('The last save failed. Close anyway and lose the unsaved changes?')) return;
    onclose();
  }

  async function askSummary() {
    clearTimeout(saveTimer);
    await save();
    if (dirty || !name.trim()) return;
    app.tab = 'chat';
    onclose();
    void sendChat(`Read the world book "${name}" (list_world_chapters, get_world_section) and write a dense, strongly compacted summary of the WHOLE book — 300 to 600 characters: key places, powers, tensions, naming conventions. Save it with set_world_summary. Do not change the book text.`);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && void close()} />
<svelte:document onvisibilitychange={() => document.hidden && dirty && ready && void save()} />

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && void close()}>
  <div class="modal" role="dialog" aria-label="World book editor">
    <header>
      <span class="logo">◍</span>
      {#if isNew}
        <input class="field name" placeholder="Book name, e.g. Aethermoor" bind:value={name} />
      {:else}
        <b class="nm">{name}</b>
      {/if}
      <span class="status" class:warn={failed || (!ready && dirty)} title="Changes are saved automatically">
        {#if failed}⚠ save failed — retrying on next edit
        {:else if !name.trim() && (text || summary)}Name the book to start saving
        {:else if !ready && dirty}Write something to start saving
        {:else if saving || (dirty && ready)}Saving…
        {:else if savedAt}✓ Saved automatically
        {:else}Autosave on{/if}
      </span>
      <span class="grow"></span>
      <span class="stat">{text.length.toLocaleString()} chars · {words.toLocaleString()} words · {headings.length} headings</span>
      <button class="btn" onclick={close} title="Close (Esc) — everything is already saved">Done</button>
    </header>

    <div class="body">
      <nav class="outline">
        <div class="label">Outline</div>
        {#each headings as h}
          <button style="padding-left:{(h.level - 1) * 12 + 8}px" onclick={() => jump(h)} title={h.title}>{h.title}</button>
        {:else}
          <p class="hint">Use <code>#</code>, <code>##</code>, <code>###</code> headings to structure the book. Each heading becomes a searchable section for the AI.</p>
        {/each}
      </nav>

      <div class="main">
        <div class="tools">
          <button class="btn ghost" onclick={() => prefixLine('# ')} title="Heading 1">H1</button>
          <button class="btn ghost" onclick={() => prefixLine('## ')} title="Heading 2">H2</button>
          <button class="btn ghost" onclick={() => prefixLine('### ')} title="Heading 3">H3</button>
          <span class="sep"></span>
          <button class="btn ghost" onclick={() => wrap('**')} title="Bold (Ctrl+B)"><b>B</b></button>
          <button class="btn ghost" onclick={() => wrap('*')} title="Italic"><i>I</i></button>
          <button class="btn ghost" onclick={bullet} title="Bullet">•</button>
        </div>
        {#if loading}
          <div class="loading">loading…</div>
        {:else}
          <textarea bind:this={ta} bind:value={text} onkeydown={onkey} spellcheck="false" placeholder={'# Aethermoor\n\nWrite as much as you like. Structure it with headings — the AI will see a compact outline and can search the full text.'}></textarea>
        {/if}
      </div>

      <aside class="side">
        <div class="label">Summary <span class="dim">— what the AI always sees</span></div>
        <textarea class="field sum" bind:value={summary} placeholder="Dense gist of the whole book: key places, powers, tensions, naming…"></textarea>
        <div class="count {sumState}">{sumLen} chars · target 300–600
          {#if sumState === 'short'}— a bit thin{:else if sumState === 'long'}— too long, trim it{:else if sumState === 'none'}— missing{/if}</div>
        <button class="btn" onclick={askSummary} disabled={!name.trim() || (!text.trim() && !savedText)}>✦ Draft it with the AI</button>

        {#if aiOutline}
          <div class="label">Outline the AI sees</div>
          <pre class="ai">{aiOutline}</pre>
        {/if}
        <p class="hint">Saved automatically. Earlier versions are kept in <code>worldbooks/.bak/</code>.</p>
      </aside>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(5, 6, 9, 0.72); backdrop-filter: blur(4px); display: grid; place-items: center; animation: pnp-pop 0.18s ease-out; }
  .modal { width: min(1280px, 94vw); height: min(860px, 90vh); display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .logo { color: #4fd1c5; font-size: 18px; text-shadow: 0 0 12px #4fd1c5; }
  .nm { font-size: 15px; }
  .name { width: 260px; }
  .status { font-size: 11.5px; color: var(--text-faint); }
  .status.warn { color: #e0c36a; }
  .grow { flex: 1; }
  .stat { font-size: 11.5px; color: var(--text-faint); }
  .body { flex: 1; display: grid; grid-template-columns: 220px minmax(0, 1fr) 300px; min-height: 0; }
  .outline { border-right: 1px solid var(--line); overflow: auto; padding: 8px 4px 20px; }
  .outline .label { padding: 0 8px; }
  .outline button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 3px 8px; color: var(--text-dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 6px; }
  .outline button:hover { background: var(--bg-3); color: var(--text); }
  .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .tools { display: flex; align-items: center; gap: 2px; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  .tools .btn { padding: 2px 9px; min-width: 30px; }
  .sep { width: 1px; height: 16px; background: var(--line-2); margin: 0 6px; }
  .main textarea { flex: 1; resize: none; border: 0; outline: none; background: var(--bg); color: var(--text); padding: 18px 26px; font: 13.5px/1.7 var(--mono); tab-size: 2; min-height: 0; }
  .loading { padding: 40px; color: var(--text-faint); text-align: center; }
  .side { border-left: 1px solid var(--line); padding: 10px 14px 20px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
  .sum { min-height: 130px; font-size: 12.5px; line-height: 1.5; }
  .count { font-size: 11.5px; color: var(--text-faint); }
  .count.ok { color: var(--ok); } .count.short, .count.long { color: #e0c36a; }
  .dim { text-transform: none; letter-spacing: 0; color: var(--text-faint); }
  .ai { margin: 0; white-space: pre-wrap; font: 11px/1.5 var(--mono); color: var(--text-dim); background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 8px; max-height: 260px; overflow: auto; }
  .hint { color: var(--text-faint); font-size: 11.5px; line-height: 1.5; padding: 4px 8px; margin: 0; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
</style>
