<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Backend, ChatAttachment, ChatMsg } from '@pnp/shared';
  import { BACKENDS, NODE_TYPE_INFO, actorName } from '@pnp/shared';
  import { answerAsk, app, cancelChat, chatMeta, clearChat, focusNode, remember, resetPanelSize, selectNode, sendChat, setPanelSize, uploadChatFile } from '../lib/app.svelte';

  /** When set, this is a per-node thread (compact, filtered to that node). */
  let { nodeId }: { nodeId?: string } = $props();

  // the unsent draft survives tab switches (this component is unmounted then)
  // svelte-ignore state_referenced_locally -- the per-node Chat is re-created per node ({#key})
  const draftKey = nodeId ?? '';
  let text = $state(app.drafts[draftKey]?.text ?? '');
  let pins = $state<string[]>([...(app.drafts[draftKey]?.pins ?? [])]);
  let files = $state<ChatAttachment[]>([...(app.drafts[draftKey]?.files ?? [])]);
  $effect(() => { app.drafts[draftKey] = { text, pins: [...pins], files: [...files] }; });
  // a picture sent here from a node's gallery (💬) while this chat is open
  $effect(() => {
    const d = app.drafts[draftKey]?.files ?? [];
    if (d.some((f) => !files.some((x) => x.id === f.id))) files = [...files, ...d.filter((f) => !files.some((x) => x.id === f.id))];
  });
  let uploading = $state(0);
  let dropping = $state(false);
  async function addFiles(list: File[]) {
    for (const f of list.slice(0, 12)) {
      uploading++;
      const a = await uploadChatFile(f);
      uploading--;
      if (a) files = [...files, a];
    }
  }
  const fileSrc = (a: ChatAttachment, w = 160) => (a.id.startsWith('att-') ? `/api/chat/attachments/${a.id}` : `/api/images/${encodeURIComponent(a.id)}?w=${w}`);
  function onpaste(e: ClipboardEvent) {
    const list = [...(e.clipboardData?.files ?? [])];
    if (!list.length) return;
    e.preventDefault();
    void addFiles(list);
  }
  function ondragover(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropping = true;
  }
  function ondrop(e: DragEvent) {
    dropping = false;
    const list = [...(e.dataTransfer?.files ?? [])];
    if (!list.length) return;
    e.preventDefault();
    void addFiles(list);
  }

  // --- the AI's questions (ask_user): the GM's picks, per message and question; "other" is typed ---
  let picks = $state<Record<string, string[][]>>({});
  let others = $state<Record<string, string[]>>({});
  function toggle(m: ChatMsg, qi: number, label: string, multiple?: boolean) {
    const cur = (picks[m.id] ??= m.ask!.questions.map(() => []));
    cur[qi] = multiple ? (cur[qi].includes(label) ? cur[qi].filter((x) => x !== label) : [...cur[qi], label]) : [label];
  }
  function answersOf(m: ChatMsg): string[][] {
    return m.ask!.questions.map((q, i) => {
      const own = (others[m.id]?.[i] ?? '').trim();
      const chosen = picks[m.id]?.[i] ?? [];
      return q.multiple ? [...chosen, ...(own ? [own] : [])] : own ? [own] : chosen;
    });
  }
  async function sendAnswer(m: ChatMsg) {
    if (await answerAsk(m.id, answersOf(m))) { delete picks[m.id]; delete others[m.id]; }
  }
  let useSelected = $state(true);
  let list: HTMLDivElement;
  let models = $state<Record<Backend, { id: string; label: string }[]> | null>(null);
  let agy = $state<{ installed: boolean; registered: boolean; permitted: boolean } | null>(null);
  let codex = $state<{ installed: boolean; loggedIn: boolean | null } | null>(null);
  let setupMsg = $state('');
  let mention = $state<{ q: string; at: number } | null>(null);

  onMount(async () => {
    const m = await chatMeta();
    models = m.models;
    agy = m.agy;
    codex = m.codex;
  });
  async function checkAgy() {
    agy = (await chatMeta(true)).agy;
  }
  async function setupAgy() {
    setupMsg = 'registering…';
    const r = await (await fetch('/api/agy/setup', { method: 'POST' })).json();
    agy = { installed: r.installed, registered: r.registered, permitted: r.permitted };
    setupMsg = r.ok ? '' : r.output || 'setup failed';
  }

  // --- what's shown --------------------------------------------------------------
  type Row = { kind: 'msg'; m: ChatMsg } | { kind: 'thread'; nodeId: string; count: number; last: string };
  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const m of app.chat) {
      if (nodeId) {
        if (m.nodeId === nodeId) out.push({ kind: 'msg', m });
      } else if (m.nodeId) {
        const prev = out[out.length - 1];
        if (prev?.kind === 'thread' && prev.nodeId === m.nodeId) {
          prev.count++;
          if (m.role !== 'tool') prev.last = m.text || prev.last;
        } else out.push({ kind: 'thread', nodeId: m.nodeId, count: 1, last: m.role !== 'tool' ? m.text : '' });
      } else out.push({ kind: 'msg', m });
    }
    return out;
  });

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    rows.length;
    app.chat.at(-1)?.text;
    app.chat.at(-1)?.tool?.status;
    app.chatStatus.busy; // the “… is working” row appears and disappears with this, a moment after the message itself
    void tick().then(() => {
      list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      // a smooth scroll aims at where the end was when it began: if something grew meanwhile (the working row, a tool card), finish the job
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (list && list.scrollHeight - list.scrollTop - list.clientHeight > 2) list.scrollTo({ top: list.scrollHeight });
      }, 450);
    });
  });

  const busy = $derived(app.chatStatus.busy);
  const selected = $derived(app.selectedId && app.nodes[app.selectedId] && !app.nodes[app.selectedId].trashed ? app.nodes[app.selectedId] : null);
  const chipIds = $derived([...new Set([...(useSelected && selected && !nodeId ? [selected.id] : []), ...pins])]);

  // --- composer ------------------------------------------------------------------
  // drag the grip above the box: dragging up makes it taller
  function dragInput(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = app.layout.input;
    const move = (ev: PointerEvent) => setPanelSize('input', h0 + (y0 - ev.clientY));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function nudgeInput(e: KeyboardEvent) {
    const d = e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0;
    if (!d) return;
    e.preventDefault();
    setPanelSize('input', app.layout.input + d);
  }
  const candidates = $derived(
    mention
      ? Object.values(app.nodes).filter((n) => !n.trashed && n.title.toLowerCase().includes(mention!.q.toLowerCase())).slice(0, 6)
      : [],
  );

  function oninput(e: Event & { currentTarget: HTMLTextAreaElement }) {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    mention = m ? { q: m[1], at: before.length - m[1].length - 1 } : null;
  }
  function pick(id: string) {
    const n = app.nodes[id];
    if (!mention || !n) return;
    text = `${text.slice(0, mention.at)}@${n.title} ${text.slice(mention.at + 1 + mention.q.length)}`;
    if (!pins.includes(id)) pins = [...pins, id];
    mention = null;
  }

  // the welcome tour types a prepared message into the main chat
  $effect(() => {
    const f = app.fill;
    if (f && f.target === 'chat' && !nodeId && !f.nodeId) text = f.text;
  });

  async function submit() {
    const t = text.trim();
    if ((!t && !files.length) || busy || uploading) return;
    const ids = chipIds.filter((id) => t.includes(`@${app.nodes[id]?.title}`) || id === selected?.id || id === nodeId);
    const ok = await sendChat(t, { nodeId, pins: ids, ...(files.length ? { attachments: files.map((f) => f.id) } : {}) });
    if (ok) {
      text = '';
      pins = [];
      files = [];
      if (app.drafts[draftKey]) app.drafts[draftKey].files = [];
    }
  }
  function onkey(e: KeyboardEvent) {
    if (mention && candidates.length && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      pick(candidates[0].id);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') mention = null;
  }

  function fmt(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
</script>

<div class="chat" class:compact={!!nodeId} class:dropping role="region" aria-label="AI chat" {ondragover} ondragleave={() => (dropping = false)} {ondrop}>
  {#if !nodeId}
    <div class="bar" data-tour="chat-bar">
      <div class="seg">
        {#each BACKENDS as b}
          <button class:on={app.backend === b} style="--c:var(--{b})" onclick={() => { app.backend = b; remember('pnp.backend', b); }}>{actorName(b)}</button>
        {/each}
      </div>
      <select
        class="field model"
        value={app.models[app.backend]}
        onchange={(e) => { app.models[app.backend] = e.currentTarget.value; remember(`pnp.model.${app.backend}`, e.currentTarget.value); }}
        title="Model"
      >
        {#each models?.[app.backend] ?? [{ id: '', label: 'default' }] as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
      <button class="btn ghost" title="Start a fresh conversation" disabled={busy} onclick={() => confirm('Clear the chat and start a new AI session?') && clearChat()}>↺</button>
    </div>
  {/if}

  {#if app.meta.tutorial?.on && !nodeId}
    <div class="demo"><b>Practice campaign.</b> The AI here is a scripted stand-in: it knows the requests the tour prepares, and does them with the real tools. In your own campaigns this is Claude, agy or Codex.</div>
  {/if}

  {#if app.backend === 'agy' && agy && agy.installed && (!agy.registered || !agy.permitted)}
    <div class="setup">
      <b>{agy.registered ? 'agy is registered but not allowed to use the tools.' : "agy isn't connected to this app yet."}</b>
      <p>This changes agy's own global config in <code>~/.gemini/antigravity-cli</code>: it registers this app's MCP server (<code>agy mcp add pennodepaper …</code>) and adds the allow-rule <code>mcp(pennodepaper/*)</code>, which headless agy needs because it can't ask for permission. Only this server is allowed; a backup is kept as <code>settings.json.pnp-backup</code>.</p>
      <button class="btn primary" onclick={setupAgy}>Connect agy</button>
      {#if setupMsg}<span class="err">{setupMsg}</span>{/if}
    </div>
  {:else if app.backend === 'agy' && agy && !agy.installed}
    <div class="setup"><b>agy not found.</b> Install the Antigravity CLI and make sure <code>agy</code> is on your PATH.</div>
  {:else if app.backend === 'codex' && codex && !codex.installed}
    <div class="setup codex"><b>Codex not found.</b> Install the Codex CLI (<code>npm install -g @openai/codex</code>), make sure <code>codex</code> is on your PATH, then log in once with <code>codex login</code>.</div>
  {:else if app.backend === 'codex' && codex && codex.loggedIn === false}
    <div class="setup codex"><b>Codex is not logged in.</b> Run <code>codex login</code> in a terminal once. Nothing needs to be registered: this app hands Codex its campaign tools with every message.</div>
  {/if}

  <div class="msgs" data-tour="chat-msgs" bind:this={list}>
    {#each rows as r, i (r.kind === 'msg' ? r.m.id : `t-${r.nodeId}-${i}`)}
      {#if r.kind === 'thread'}
        {@const n = app.nodes[r.nodeId]}
        <button class="thread" onclick={() => { selectNode(r.nodeId); if (n) focusNode(r.nodeId); }}>
          <span>💬</span>
          <span class="tt">Thread on <b>{n?.title ?? r.nodeId}</b> · {r.count} message{r.count > 1 ? 's' : ''}</span>
          {#if r.last}<span class="tl">{r.last.slice(0, 90)}</span>{/if}
        </button>
      {:else}
        {@const m = r.m}
        {#if m.role === 'user'}
          <div class="user">
            {#if m.attachments?.length}
              <div class="atts">
                {#each m.attachments as a (a.id)}
                  {#if a.kind === 'image'}<a href={fileSrc(a, 720)} target="_blank" rel="noopener" title={a.name}><img src={fileSrc(a)} alt={a.name} loading="lazy" /></a>
                  {:else}<a class="fchip" href={fileSrc(a)} title="Download">📄 {a.name}</a>{/if}
                {/each}
              </div>
            {/if}
            <div class="b">{m.text}</div>
          </div>
        {:else if m.role === 'assistant' && m.ask}
          {@const answered = m.ask.answered}
          <div class="ai ask" style="--c:var(--{m.backend})">
            <span class="who">{actorName(m.backend)} asks</span>
            <div class="b">
              {#each m.ask.questions as q, qi}
                {#if q.header}<div class="qh">{q.header}</div>{/if}
                <div class="qq">{q.question}</div>
                {#if answered}
                  <div class="qa">→ {answered[qi]?.picked.join(', ') || '(no answer)'}</div>
                {:else}
                  <div class="opts">
                    {#each q.options as o}
                      {@const on = (picks[m.id]?.[qi] ?? []).includes(o.label)}
                      <label class="opt" class:on>
                        <input type={q.multiple ? 'checkbox' : 'radio'} name={`${m.id}-${qi}`} checked={on} onchange={() => toggle(m, qi, o.label, q.multiple)} />
                        <span><b>{o.label}</b>{#if o.description}<span class="od">{o.description}</span>{/if}</span>
                      </label>
                    {/each}
                    <input class="field other" placeholder={q.multiple ? 'Something else as well…' : 'Or your own answer…'} value={others[m.id]?.[qi] ?? ''} oninput={(e) => { (others[m.id] ??= [])[qi] = e.currentTarget.value; }} />
                  </div>
                {/if}
              {/each}
              {#if !answered}
                <button class="btn primary" disabled={busy || answersOf(m).every((a) => !a.length)} onclick={() => sendAnswer(m)}>Answer</button>
              {/if}
            </div>
          </div>
        {:else if m.role === 'assistant' && !m.text && !m.streaming}
          <!-- a turn that only called tools has no text: the tool cards say it all -->
        {:else if m.role === 'assistant'}
          <div class="ai" style="--c:var(--{m.backend})">
            <span class="who">{m.demo ? 'Tutorial AI' : actorName(m.backend)}</span>
            <div class="b">{@html fmt(m.text)}{#if m.streaming}<span class="caret"></span>{/if}</div>
          </div>
        {:else if m.role === 'tool' && m.tool}
          <div class="tool" class:err={m.tool.status === 'error'} style="--c:var(--{m.backend})">
            <span class="st">{#if m.tool.status === 'running'}<i class="spin"></i>{:else if m.tool.status === 'ok'}✓{:else}✗{/if}</span>
            <code>{m.tool.name}</code>
            <span class="sum">{m.tool.summary}</span>
            {#if m.text}<span class="et">{m.text}</span>{/if}
          </div>
        {:else}
          <div class="sys">{m.text}</div>
        {/if}
      {/if}
    {:else}
      <div class="hello">
        <div class="big">✦</div>
        {#if nodeId}
          <p>Ask the AI about this node. It can see the node and the whole campaign.</p>
        {:else}
          <p><b>Your co-GM.</b> Ask it to build, link, move, or review nodes — you'll watch it work on the canvas.</p>
          <div class="ex">
            {#each ['Prepare three tavern rumours as pool nodes', 'Which pool nodes could fit after the ledger clue?', 'Link every NPC to the scene where they first appear'] as ex}
              <button class="chip" onclick={() => (text = ex)}>{ex}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if busy}
      <div class="think" style="--c:var(--{app.chatStatus.backend ?? 'claude'})"><i class="spin"></i> {app.chatStatus.demo ? 'Tutorial AI' : actorName(app.chatStatus.backend ?? 'claude')} is working…
        <button class="btn ghost" onclick={() => cancelChat()}>stop</button></div>
    {/if}
  </div>

  <div class="composer" data-tour={nodeId ? undefined : 'chat-composer'}>
    {#if chipIds.length}
      <div class="ctx">
        <span class="lab">context</span>
        {#each chipIds as id}
          {@const n = app.nodes[id]}
          {#if n}
            <span class="cchip" style="--tc:{NODE_TYPE_INFO[n.type].color}">{NODE_TYPE_INFO[n.type].icon} {n.title}
              {#if id === selected?.id && !pins.includes(id)}<button title="don't include" onclick={() => (useSelected = false)}>×</button>
              {:else if pins.includes(id)}<button onclick={() => (pins = pins.filter((p) => p !== id))}>×</button>{/if}
            </span>
          {/if}
        {/each}
      </div>
    {:else if selected && !useSelected && !nodeId}
      <button class="ctx off" onclick={() => (useSelected = true)}>+ include “{selected.title}”</button>
    {/if}
    {#if mention && candidates.length}
      <div class="mention">
        {#each candidates as n, i}
          <button class:hot={i === 0} onmousedown={(e) => { e.preventDefault(); pick(n.id); }}>
            <span style="color:{NODE_TYPE_INFO[n.type].color}">{NODE_TYPE_INFO[n.type].icon}</span> {n.title}
          </button>
        {/each}
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="grip" role="separator" aria-orientation="horizontal" aria-valuenow={app.layout.input} aria-label="Resize the message box (double-click to reset)" tabindex="0" title="Drag to resize the message box — double-click to reset" onpointerdown={dragInput} ondblclick={() => resetPanelSize('input')} onkeydown={nudgeInput}></div>
    {#if files.length || uploading}
      <div class="files">
        {#each files as a (a.id)}
          <span class="file" title={a.name}>
            {#if a.kind === 'image'}<img src={fileSrc(a, 96)} alt="" />{:else}<span class="fi">📄</span>{/if}
            <span class="fn">{a.name}</span>
            <button title="Remove" onclick={() => (files = files.filter((x) => x.id !== a.id))}>×</button>
          </span>
        {/each}
        {#if uploading}<span class="file up"><i class="spin"></i> uploading…</span>{/if}
      </div>
    {/if}
    <div class="row">
      <label class="btn ghost clip" title="Attach pictures or files (or drop them here, or paste a picture)">📎<input type="file" multiple hidden onchange={(e) => { const l = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; void addFiles(l); }} /></label>
      <textarea class="field" style="height:{app.layout.input}px" placeholder={nodeId ? 'Ask about this node…' : 'Ask the AI… (@ to mention a node, Enter to send, 📎 or drop files)'} bind:value={text} {oninput} {onpaste} onkeydown={onkey} disabled={busy}></textarea>
      <button class="btn primary send" disabled={busy || !!uploading || (!text.trim() && !files.length)} onclick={submit}>↑</button>
    </div>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .chat.compact { height: 360px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
  .bar { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); align-items: center; }
  .seg { display: flex; background: var(--bg); border: 1px solid var(--line-2); border-radius: 99px; padding: 2px; }
  .seg button { background: transparent; border: 0; border-radius: 99px; padding: 3px 12px; color: var(--text-dim); }
  .seg button.on { background: var(--c); color: #0a0c11; font-weight: 600; }
  .model { width: auto; flex: 1; padding: 3px 8px; }
  .demo { margin: 8px 10px 0; padding: 8px 11px; border: 1px solid #2c5a3e; border-left: 3px solid var(--ok); border-radius: var(--radius-s); background: #12301f; font-size: 12px; color: var(--text-dim); line-height: 1.45; }
  .demo b { color: var(--ok); }
  .setup { margin: 8px 10px 0; padding: 10px 12px; border: 1px solid var(--line-2); border-left: 3px solid var(--agy); border-radius: var(--radius-s); background: var(--bg-3); font-size: 12px; }
  .setup.codex { border-left-color: var(--codex); }
  .setup p { margin: 4px 0 8px; color: var(--text-dim); }
  .setup code, .tool code, .b :global(code) { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
  .err { color: var(--danger); margin-left: 8px; }
  .msgs { flex: 1; overflow: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .user { align-self: flex-end; max-width: 88%; }
  .chat.dropping .composer { outline: 2px dashed var(--accent); outline-offset: -4px; }
  .atts { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; margin-bottom: 4px; }
  .atts img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line-2); display: block; }
  .fchip { font-size: 11.5px; padding: 3px 8px; border: 1px solid var(--line-2); border-radius: 8px; color: var(--text-dim); background: var(--bg-3); text-decoration: none; }
  .files { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
  .file { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 2px 4px 2px 2px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg-3); max-width: 180px; }
  .file img { width: 26px; height: 26px; object-fit: cover; border-radius: 6px; }
  .file .fi { width: 26px; text-align: center; }
  .file .fn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file button { background: transparent; border: 0; color: var(--text-dim); padding: 0 3px; }
  .file.up { padding: 4px 8px; color: var(--text-dim); }
  .clip { width: 34px; height: 34px; padding: 0; display: grid; place-items: center; cursor: pointer; }
  .ask .qh { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--c); margin-top: 4px; }
  .ask .qq { font-weight: 600; margin: 2px 0 6px; white-space: normal; }
  .ask .qa { color: var(--text-dim); margin-bottom: 6px; }
  .opts { display: grid; gap: 4px; margin-bottom: 8px; white-space: normal; }
  .opt { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: 8px; cursor: pointer; background: var(--bg); }
  .opt.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--bg)); }
  .opt input { margin-top: 3px; accent-color: var(--c); }
  .opt .od { display: block; font-size: 11.5px; color: var(--text-dim); }
  .other { font-size: 12px; padding: 5px 8px; }
  .user .b { background: var(--accent-soft); border: 1px solid #2f4170; padding: 7px 11px; border-radius: 12px 12px 3px 12px; white-space: pre-wrap; }
  .ai { max-width: 94%; animation: pnp-pop 0.2s ease-out; }
  .who { font-size: 10px; letter-spacing: 0.06em; font-weight: 600; color: var(--c); text-transform: uppercase; }
  .ai .b { margin-top: 2px; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 2px solid var(--c); padding: 7px 11px; border-radius: 3px 12px 12px 12px; white-space: pre-wrap; line-height: 1.5; }
  .caret { display: inline-block; width: 6px; height: 13px; background: var(--c); margin-left: 2px; vertical-align: -2px; animation: pnp-ring 0.9s infinite; }
  .tool { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 4px 9px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; font-size: 12px; margin-left: 10px; color: var(--text-dim); animation: pnp-pop 0.2s ease-out; }
  .tool .st { color: var(--ok); width: 14px; text-align: center; }
  .tool.err .st, .tool .et { color: var(--danger); }
  .tool code { color: var(--c); }
  .tool .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .thread { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; text-align: left; background: var(--bg-3); border: 1px dashed var(--line-2); border-radius: var(--radius-s); padding: 6px 10px; color: var(--text-dim); }
  .thread:hover { border-color: var(--accent); color: var(--text); }
  .tt b { color: var(--text); }
  .tl { font-size: 11.5px; color: var(--text-faint); font-style: italic; flex-basis: 100%; }
  .sys { align-self: center; color: var(--danger); font-size: 12px; background: #2a1518; border: 1px solid #5a2a30; padding: 6px 10px; border-radius: 8px; max-width: 94%; white-space: pre-wrap; }
  .think { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
  .spin { width: 11px; height: 11px; border: 2px solid var(--line-2); border-top-color: var(--c, var(--accent)); border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hello { text-align: center; color: var(--text-dim); padding: 28px 12px; }
  .hello .big { font-size: 34px; color: var(--line-2); }
  .ex { display: grid; gap: 6px; margin-top: 12px; }
  .ex .chip { cursor: pointer; text-align: left; padding: 5px 10px; border-radius: 8px; font-size: 12px; }
  .ex .chip:hover { border-color: var(--accent); color: var(--text); }
  .composer { padding: 8px 10px 10px; border-top: 1px solid var(--line); position: relative; }
  .ctx { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
  .ctx.off { background: transparent; border: 0; color: var(--text-faint); font-size: 11.5px; padding: 0; margin-bottom: 6px; }
  .lab { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
  .cchip { display: inline-flex; gap: 5px; align-items: center; font-size: 11.5px; padding: 1px 4px 1px 8px; border-radius: 99px; border: 1px solid var(--tc); background: color-mix(in srgb, var(--tc) 12%, transparent); }
  .cchip button { background: transparent; border: 0; color: var(--text-dim); padding: 0 4px; }
  .row { display: flex; gap: 6px; align-items: flex-end; }
  .grip { height: 8px; margin: -2px 0 2px; cursor: ns-resize; position: relative; touch-action: none; }
  .grip::after { content: ''; position: absolute; left: 50%; top: 3px; width: 32px; height: 3px; margin-left: -16px; border-radius: 3px; background: var(--line-2); }
  .grip:hover::after, .grip:focus-visible::after { background: var(--accent); }
  .row textarea { resize: none; min-height: 0; }
  .send { width: 34px; height: 34px; padding: 0; border-radius: 10px; font-size: 16px; }
  .mention { position: absolute; bottom: 100%; left: 10px; right: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: var(--radius-s); overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
  .mention button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 6px 10px; }
  .mention button.hot, .mention button:hover { background: var(--accent-soft); }
</style>
